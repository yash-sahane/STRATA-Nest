import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  generateId,
  paginate,
  parseListQuery,
  sameFieldValue,
  type ListQuerySpec,
} from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { PermissionKey } from '../authz/permissions';
import { DENY_MESSAGE, WorkspaceAccessService } from '../authz/workspace-access.service';
import { writeAuditRow, type AuditAction } from '../activity/audit-writer';

interface Delegate {
  findMany(args: unknown): Promise<unknown[]>;
  findFirst(args: unknown): Promise<unknown>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
  delete(args: unknown): Promise<unknown>;
}

/**
 * `dueDate` -> "due date", for a message a person reads.
 *
 * Naming the field is the difference between "something changed, work out what" and
 * "they changed the priority" — the second tells somebody whether they even care, and
 * whether their own edit is still worth reapplying.
 */
function fieldLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\bId\b/i, '')
    .trim()
    .toLowerCase();
}

/** "the title", "the title and the priority", "the title, the status and the priority". */
function fieldList(names: readonly string[]): string {
  const labelled = names.map((n) => `the ${fieldLabel(n)}`);
  if (labelled.length <= 1) return labelled[0] ?? 'this';
  return `${labelled.slice(0, -1).join(', ')} and ${labelled[labelled.length - 1]}`;
}

/**
 * What a refused save says. Exported because the same wording has to be recognisable from
 * the API tests and the end-to-end suite, and because a near-copy that drifts is how a
 * message ends up reading like a server error.
 *
 * Written for the person who pressed Save: what happened, which field, what it cost them,
 * and what to do — because a bare "Conflict" leaves somebody staring at a form guessing
 * whether their work survived.
 */
export function changedWhileEditing(fields: readonly string[]): string {
  return (
    `Somebody else changed ${fieldList(fields)} while you were editing. Your version has ` +
    'not been applied. Reload to see theirs, then make your change again.'
  );
}
export const DELETED_WHILE_EDITING =
  'This was deleted while you were editing it, so your change could not be saved.';

/**
 * The envelope `type` these two answer with (AllExceptionsFilter honours a `type` pinned
 * on the exception payload). A 409 already means several different things in this API —
 * a project code in use, a requirement with children blocking its delete — and a 404 is
 * mostly an ordinary missing row, so the status alone cannot tell the client which one
 * this is. The frontend keys the wording of its toast on these rather than on the message
 * text, which would break the moment either sentence is reworded.
 */
export const CHANGED_WHILE_EDITING_TYPE = 'ChangedWhileEditing';
export const DELETED_WHILE_EDITING_TYPE = 'DeletedWhileEditing';

/**
 * Workspace-scoped CRUD base for the thin collections. Enforces
 * membership-scoped reads (out-of-scope detail → 404) and the write
 * permission via WorkspaceAccessService (RBAC flag aware). Concrete services
 * supply the Prisma model name, list spec, write permission, and row mapper.
 */
export abstract class ScopedCrudService<TRow extends { workspaceId?: string }, TResponse> {
  protected abstract readonly model: string;
  protected abstract readonly spec: ListQuerySpec;
  protected abstract readonly writePermission: PermissionKey;
  /**
   * Permission for `update`, when changing a row is a lesser act than creating
   * or deleting one. Defaults to `writePermission`, so a collection that does
   * not draw the distinction is unaffected.
   */
  protected get updatePermission(): PermissionKey {
    return this.writePermission;
  }
  protected readonly scopeField: string = 'workspaceId';
  /**
   * Column holding the id of the user a row belongs to, for collections whose
   * rows are personal (leave requests, attendance, time entries, notifications,
   * saved searches). When set, `update`/`remove` additionally require that the
   * caller owns the row — the workspace-level write permission alone is NOT
   * enough, because every member holds it for their own records. A non-owner
   * needs `ownerOverridePermission` (the manager permission for that domain).
   * Left undefined the collection is workspace-owned and nothing changes.
   */
  protected readonly ownerField?: string;
  protected readonly ownerOverridePermission?: PermissionKey;
  /**
   * Permission required to READ this collection, for rows ordinary members must
   * not see (a pending invitation carries its acceptance token and reveals who
   * is being brought in). When set, `list`/`findScoped` narrow the workspace
   * scope to the workspaces where the caller actually holds it, so an
   * unreadable row 404s exactly like an out-of-workspace one — the narrowing is
   * applied to the query, so no filter in the query string can widen it back.
   * Left undefined the collection is readable by any member (the default).
   */
  protected readonly readPermission?: PermissionKey;
  /**
   * Entity name for the append-only audit trail. Set it and every create,
   * update and delete through this base writes an ActivityLog row.
   *
   * The trail used to be fed only by AuditSubscriber, which listens to the
   * eight membership/HR domain events — so the whole planning domain (projects,
   * epics, sprints, requirements, tasks) left no trace at all and the Activity
   * screen was empty in normal use. Domain events stay reserved for things with
   * business meaning (there is deliberately no generic `*Updated` event); plain
   * CRUD is recorded here instead, which is exactly the shape ActivityLog was
   * designed for (action / entityType / entityId / changes).
   *
   * Deliberately NOT set on: activityLog (it would audit its own writes),
   * savedSearch and notification (personal or system-generated noise), and
   * attendance / timeEntry (high-volume personal records whose meaningful
   * transitions — approve, reject — are already audited as domain events).
   */
  protected readonly auditEntity?: string;
  /**
   * Set on the collections whose table carries a `version` column (see the
   * optimistic_locking_version migration).
   *
   * The counter is not something any client sends or sees. It is the token that makes
   * the conflict check atomic: `writeUpdate` reads the row, decides whether the fields
   * being written still hold what the editor believed, then writes CONDITIONALLY on the
   * version it read — so a third save landing in that gap cannot slip past the check.
   *
   * Opt-in rather than detected from the row, because `version` is a plausible column
   * name for something that is not a lock (a document revision, an API version) and a
   * base class shared by twenty collections should not decide that on its own. Passing
   * `basedOn` to a collection that has not opted in throws rather than being ignored, so
   * the mistake is loud instead of being a screen that believes it is protected.
   */
  protected readonly versioned: boolean = false;
  protected abstract map(row: TRow): TResponse;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly access: WorkspaceAccessService,
  ) {}

  protected get delegate(): Delegate {
    return (this.prisma as unknown as Record<string, Delegate>)[this.model];
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<TResponse>> {
    const scope = await this.readScope(user);
    const parsed = parseListQuery(query, this.spec);
    const where = { AND: [scope, parsed.where] };
    const [rows, total] = await Promise.all([
      this.delegate.findMany({ where, orderBy: parsed.orderBy, skip: parsed.skip, take: parsed.take }),
      this.delegate.count({ where }),
    ]);
    return paginate(
      (rows as TRow[]).map((r) => this.map(r)),
      total,
      parsed.page,
      parsed.pageSize,
    );
  }

  async retrieve(user: User, id: string): Promise<TResponse> {
    return this.map(await this.findScoped(user, id));
  }

  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    await this.access.assertPermission(user, this.workspaceOf(row), this.writePermission);
    await this.assertRowOwnership(user, row);
    await this.delegate.delete({ where: { id } });
    await this.recordAudit(
      user,
      this.workspaceOf(row),
      'deleted',
      id,
      row as Record<string, unknown>,
    );
  }

  /**
   * `basedOn` is what the caller believed the fields they are changing held when they
   * started (see the BasedOn decorator). Supplied, the save is refused if any of those
   * fields has been changed since; omitted, it applies the way it always did.
   */
  async update(
    user: User,
    id: string,
    data: Record<string, unknown>,
    basedOn?: Record<string, unknown>,
  ): Promise<TResponse> {
    const row = await this.findScoped(user, id);
    await this.access.assertPermission(user, this.workspaceOf(row), this.updatePermission);
    await this.assertRowOwnership(user, row);
    const updated = await this.writeUpdate(id, row, data, basedOn);
    await this.recordAudit(
      user,
      this.workspaceOf(row),
      'updated',
      id,
      updated as Record<string, unknown>,
      Object.keys(data),
    );
    return this.map(updated);
  }

  /**
   * The fields in `basedOn` that no longer hold what the caller believed.
   *
   * Compared against `map(row)` rather than the raw row, because `basedOn` is the row as
   * the API rendered it — that is where the client got the values. The two
   * representations differ in ways that would otherwise read as a conflict on every
   * single save: `dueDate` is a microsecond ISO string in the response and a `Date` in
   * the row, `startDate` is `yyyy-MM-dd` in the response and a full instant in the row.
   *
   * Keys `basedOn` carries but `data` does not write are ignored. The check must never be
   * wider than the edit — that is the whole difference between this and a row-level
   * version counter, and the reason two people editing different fields are both left
   * alone rather than one of them being sent away to redo work that clashed with nothing.
   */
  private conflictingFields(
    row: TRow,
    data: Record<string, unknown>,
    basedOn: Record<string, unknown>,
  ): string[] {
    const rendered = this.map(row) as unknown as Record<string, unknown>;
    return Object.keys(basedOn).filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(data, field) &&
        !sameFieldValue(rendered[field], basedOn[field]),
    );
  }

  /**
   * The write itself.
   *
   * Without `basedOn` this is the plain update it has always been, plus the version bump
   * — which happens on EVERY edit, not only the checked ones. If the counter moved only
   * for callers that sent a `basedOn`, a save from an older client could land in the gap
   * between another client's read and its write and go unnoticed.
   *
   * With `basedOn`: read, compare, then write conditionally on the version that was read.
   * `updateMany` rather than `update`, because Prisma's `update` takes only unique columns
   * in `where` and the condition that matters here is on a non-unique one. A zero count
   * means somebody wrote in the gap, so the answer is not "conflict" — it is "look
   * again", which is what the loop does; the comparison then runs against what they
   * actually wrote. Bounded at three attempts: a row being rewritten that fast is
   * contention rather than an edit to reconcile, and somebody waiting on a save deserves
   * an answer either way.
   */
  private async writeUpdate(
    id: string,
    row: TRow,
    data: Record<string, unknown>,
    basedOn?: Record<string, unknown>,
  ): Promise<TRow> {
    if (!this.versioned) {
      if (basedOn !== undefined) {
        throw new Error(
          `${this.model} has no version column; remove basedOn or set versioned = true.`,
        );
      }
      return (await this.delegate.update({ where: { id }, data })) as TRow;
    }
    const withBump = { ...data, version: { increment: 1 } };
    if (basedOn === undefined) {
      return (await this.delegate.update({ where: { id }, data: withBump })) as TRow;
    }

    let current: TRow | null = row;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!current) {
        throw new NotFoundException({
          message: DELETED_WHILE_EDITING,
          type: DELETED_WHILE_EDITING_TYPE,
        });
      }
      const clashing = this.conflictingFields(current, data, basedOn);
      if (clashing.length > 0) {
        throw new ConflictException({
          message: changedWhileEditing(clashing),
          type: CHANGED_WHILE_EDITING_TYPE,
          fields: clashing,
        });
      }
      const { count } = await this.delegate.updateMany({
        where: { id, version: (current as unknown as { version: number }).version },
        data: withBump,
      });
      if (count === 1) return (await this.delegate.findFirst({ where: { id } })) as TRow;
      current = (await this.delegate.findFirst({ where: { id } })) as TRow | null;
    }
    throw new ConflictException({
      message:
        'This is being changed by several people at once, so your save could not be ' +
        'applied. Reload and try again.',
      type: CHANGED_WHILE_EDITING_TYPE,
      fields: [],
    });
  }

  /** Row-level guard for personal collections (see `ownerField`): the caller
   *  must own the row, hold the domain's override permission, or be a platform
   *  admin. A no-op for workspace-owned collections. */
  protected async assertRowOwnership(user: User, row: TRow): Promise<void> {
    if (!this.ownerField) return;
    if (this.access.isPlatformAdmin(user)) return;
    if ((row as Record<string, unknown>)[this.ownerField] === user.id) return;
    if (
      this.ownerOverridePermission &&
      (await this.access.can(user, this.workspaceOf(row), this.ownerOverridePermission))
    ) {
      return;
    }
    throw new ForbiddenException(DENY_MESSAGE);
  }

  /** Create in a workspace after asserting the write permission there. */
  protected async createIn(
    user: User,
    workspaceId: string,
    data: Record<string, unknown>,
  ): Promise<TResponse> {
    await this.access.assertPermission(user, workspaceId, this.writePermission);
    const row = (await this.delegate.create({ data: { id: generateId(), ...data } })) as TRow;
    const created = row as Record<string, unknown>;
    await this.recordAudit(user, workspaceId, 'created', String(created.id ?? ''), created);
    return this.map(row);
  }

  protected async findScoped(user: User, id: string): Promise<TRow> {
    const scope = await this.readScope(user);
    const row = await this.delegate.findFirst({ where: { AND: [scope, { id }] } });
    if (!row) throw new NotFoundException('Not found.');
    return row as TRow;
  }

  /** The where-fragment every read is scoped by: accessible workspaces, further
   *  narrowed by `readPermission` when the collection declares one. Subclasses
   *  override to widen it for rows whose owner is not (yet) a member. */
  protected async readScope(user: User): Promise<Record<string, unknown>> {
    const scope = await this.access.scopeWhere(user, this.scopeField);
    const permission = this.readPermission;
    if (!permission || this.access.isPlatformAdmin(user)) return scope;
    const ids = (await this.access.accessibleWorkspaceIds(user)) ?? [];
    const granted = await Promise.all(ids.map((id) => this.access.can(user, id, permission)));
    return { [this.scopeField]: { in: ids.filter((_, i) => granted[i]) } };
  }

  protected workspaceOf(row: TRow): string {
    return (row as Record<string, unknown>)[this.scopeField] as string;
  }

  /** Append one audit row for this collection, when it opts in via `auditEntity`. */
  protected async recordAudit(
    user: User,
    workspaceId: string | undefined,
    action: AuditAction,
    entityId: string,
    row?: Record<string, unknown>,
    changedFields?: string[],
  ): Promise<void> {
    if (!this.auditEntity) return;
    await writeAuditRow(this.prisma, {
      workspaceId,
      userId: user.id,
      entity: this.auditEntity,
      action,
      entityId,
      row,
      changedFields,
    });
  }
}
