import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
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
  delete(args: unknown): Promise<unknown>;
}

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

  async update(user: User, id: string, data: Record<string, unknown>): Promise<TResponse> {
    const row = await this.findScoped(user, id);
    await this.access.assertPermission(user, this.workspaceOf(row), this.updatePermission);
    await this.assertRowOwnership(user, row);
    const updated = (await this.delegate.update({ where: { id }, data })) as TRow;
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
