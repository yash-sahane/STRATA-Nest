import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import { generateId, type ListQuerySpec } from '@strata/common';
import { WorkspaceEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type {
  InviteCode,
  JoinRequest,
  Prisma,
  User,
  WorkspaceRole,
} from '@prisma/client';
import { describeCapabilities } from '../authz/administration';
import {
  PERMISSION_KEYS,
  Permission,
  isBuiltInRole,
  permissionsForRole,
  withImplied,
  type PermissionKey,
} from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type {
  CreateInviteCodeDto,
  CreateJoinRequestDto,
  CreateRoleDto,
  UpdateInviteCodeDto,
  UpdateJoinRequestDto,
  UpdateRoleDto,
} from './dto';
import {
  inviteCodeResponse,
  joinRequestResponse,
  roleResponse,
} from './mappers';
import { ScopedCrudService } from './scoped-crud.base';

const code = () => randomBytes(8).toString('base64url').slice(0, 10).toUpperCase();

@Injectable()
export class WorkspaceRolesService extends ScopedCrudService<
  WorkspaceRole,
  ReturnType<typeof roleResponse>
> {
  protected readonly model = 'workspaceRole';
  protected readonly auditEntity = 'workspace_role';
  protected readonly writePermission: PermissionKey = Permission.RoleManage;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, name: { field: 'name' } },
    sortable: { createdAt: 'createdAt', name: 'name' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: WorkspaceRole) {
    return roleResponse(row);
  }

  /** A built-in role name would be shadowed silently — permissionsForRole always
   *  prefers the built-in map, so such a row is inert. Reject it instead. */
  private assertNotBuiltIn(name: string): void {
    // Own-property test: a bare index lookup also matched Object.prototype keys.
    if (isBuiltInRole(name)) {
      throw new BadRequestException(`"${name}" is a built-in role and cannot be redefined.`);
    }
  }

  /** Custom roles must name real permissions. Applied ONLY to caller-supplied
   *  lists: running it over a STORED list made a legacy row holding an
   *  unrecognised key (`tasks:write` for `task:write`, writable before this
   *  DTO was validated) impossible to rename, with a 400 naming a permission
   *  the caller never sent. */
  private assertKnownPermissions(permissions: string[]): void {
    const unknown = permissions.filter((p) => !PERMISSION_KEYS.has(p));
    if (unknown.length) {
      throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')}.`);
    }
  }

  /** Nobody may grant themselves a permission they do not already hold —
   *  otherwise role:manage escalates to every permission, including
   *  workspace:delete. Unrecognised keys are ignored here: they cannot name a
   *  real capability, so they cannot be an escalation. */
  private async assertNoEscalation(
    user: User,
    workspaceId: string,
    permissions: string[],
  ): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    const held = await this.access.permissions(user, workspaceId);
    if (held.has('*')) return;
    const escalating = permissions.filter((p) => PERMISSION_KEYS.has(p) && !held.has(p));
    if (escalating.length) {
      throw new ForbiddenException(
        `You cannot grant permissions you do not hold: ${escalating.join(', ')}.`,
      );
    }
  }

  private async assertGrantable(
    user: User,
    workspaceId: string,
    permissions: string[],
  ): Promise<void> {
    this.assertKnownPermissions(permissions);
    await this.assertNoEscalation(user, workspaceId, permissions);
  }

  /**
   * A role the workspace OWNER holds is not cut down by anybody else.
   *
   * The owner's membership cannot be demoted, removed or moved by another
   * member — but their role's DEFINITION could be: a manager who was not the
   * owner emptied the owner's custom role on this screen, which is a demotion of
   * the owner by another door, and the one guard keyed on identity never ran.
   * The owner may still trim a role they hold, and a platform administrator
   * may repair one, as with the membership itself. Adding permissions is never
   * refused here; renaming is not a change of power at all.
   */
  private async assertOwnersRoleKept(
    user: User,
    existing: WorkspaceRole,
    next: string[],
  ): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    const stored = Array.isArray(existing.permissions) ? (existing.permissions as string[]) : [];
    const before = permissionsForRole(existing.name, stored);
    const after = permissionsForRole(existing.name, next);
    if (![...before].some((p) => PERMISSION_KEYS.has(p) && !after.has(p))) return;
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: existing.workspaceId },
      select: { ownerId: true },
    });
    if (!workspace || workspace.ownerId === user.id) return;
    const ownerHolds = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: existing.workspaceId, userId: workspace.ownerId, role: existing.name },
      select: { id: true },
    });
    if (ownerHolds) {
      throw new ForbiddenException(
        `The workspace owner holds the "${existing.name}" role, so only they or a platform administrator can take permissions away from it.`,
      );
    }
  }

  /**
   * Nor is a role cut down so far that nobody active is left able to administer
   * the workspace — the same invariant a membership change answers to, asked of
   * the workspace as this new permission list would leave it.
   */
  private async assertStillAdministered(
    user: User,
    existing: WorkspaceRole,
    next: string[],
  ): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    const orphaned = await this.access.capabilitiesOrphanedBy(existing.workspaceId, {
      roleName: existing.name,
      permissions: next,
    });
    if (orphaned.length) {
      throw new ForbiddenException(
        `That would leave nobody active in this workspace who can ${describeCapabilities(orphaned)}. Give that to another member's role first.`,
      );
    }
  }

  async create(user: User, dto: CreateRoleDto) {
    // role:manage FIRST, so an unauthorized caller always terminates on the
    // frozen DENY_MESSAGE. The checks below throw with detail (the escalating
    // permission names), which is an enumeration oracle for the workspace's
    // whole RBAC configuration if it can be reached without the permission.
    await this.access.assertPermission(user, dto.workspaceId, Permission.RoleManage);
    this.assertNotBuiltIn(dto.name);
    // Stored with what each key implies (task:write brings task:update), and
    // checked as stored: what the role WILL hold is what may not exceed yours.
    const permissions = withImplied(dto.permissions ?? []);
    await this.assertGrantable(user, dto.workspaceId, permissions);
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      name: dto.name,
      permissions,
    });
  }
  async patch(user: User, id: string, dto: UpdateRoleDto) {
    const data: Record<string, unknown> = {};
    const existing =
      dto.name !== undefined || dto.permissions !== undefined
        ? await this.findScoped(user, id)
        : null;
    // See create(): every detailed exception below is gated behind role:manage.
    if (existing) {
      await this.access.assertPermission(user, existing.workspaceId, Permission.RoleManage);
    }
    let rename: { from: string; to: string; workspaceId: string } | null = null;
    if (dto.name !== undefined && existing) {
      this.assertNotBuiltIn(dto.name);
      // A rename is a permission grant by another door: memberships store the
      // role NAME, so moving a name onto a different permission set silently
      // re-points every member holding it. You may only rename a role whose
      // permissions you already hold — otherwise deleting your own `Lead` row
      // and renaming `Owner` to `Lead` hands you workspace:delete without ever
      // calling a grant. Escalation only: an unrecognised STORED key must not
      // make the row unrenameable.
      if (dto.name !== existing.name) {
        await this.assertNoEscalation(
          user,
          existing.workspaceId,
          Array.isArray(existing.permissions) ? (existing.permissions as string[]) : [],
        );
        rename = { from: existing.name, to: dto.name, workspaceId: existing.workspaceId };
      }
      data.name = dto.name;
    }
    if (dto.permissions !== undefined && existing) {
      // What the role carries NOW has to be within the caller's own reach too,
      // not only what it is being changed to. Checking the new list alone let
      // somebody with `role:manage` empty out a role that outranks them — every
      // holder demoted in one save, where changing any one of those members
      // would have been refused.
      await this.assertNoEscalation(
        user,
        existing.workspaceId,
        Array.isArray(existing.permissions) ? (existing.permissions as string[]) : [],
      );
      const permissions = withImplied(dto.permissions);
      await this.assertGrantable(user, existing.workspaceId, permissions);
      // Taking power away from a role takes it from everybody holding it.
      await this.assertOwnersRoleKept(user, existing, permissions);
      await this.assertStillAdministered(user, existing, permissions);
      data.permissions = permissions;
    }
    // Every row that stores the role by NAME follows it, in the SAME transaction
    // as the rename itself. Refusing the rename while the name was in use only
    // ever covered memberships, and left invite codes naming a role that no
    // longer exists — `assertValidRole` then 400s the redemption with
    // `Unknown role "Lead"`, permanently bricking the code with a message
    // pointing at a role the inviter can no longer see.
    // Cascading is not a privilege change: every carried row keeps pointing at
    // the same WorkspaceRole with the same permissions.
    if (rename) {
      const scope = { workspaceId: rename.workspaceId, role: rename.from };
      const [row] = await this.prisma.$transaction([
        this.prisma.workspaceRole.update({
          where: { id },
          data: data as Prisma.WorkspaceRoleUpdateInput,
        }),
        this.prisma.workspaceMember.updateMany({ where: scope, data: { role: rename.to } }),
        this.prisma.inviteCode.updateMany({ where: scope, data: { role: rename.to } }),
      ]);
      // `updateMany` is invisible to the write hook, so the holders' open
      // screens went on resolving their permissions under the old name — which
      // now matched no role, and read as the read-only floor until a reload.
      const moved = await this.prisma.workspaceMember.findMany({
        where: { workspaceId: rename.workspaceId, role: rename.to },
      });
      for (const member of moved) this.prisma.announceWrite?.('WorkspaceMember', 'update', member);
      return this.map(row);
    }
    return this.update(user, id, data);
  }

  /**
   * A role somebody still holds, or an invite code still hands out, is not
   * deleted from under them.
   *
   * Memberships and invite codes store the role by NAME. Deleting the row left
   * every holder on a name that resolves to nothing — which `permissionsForRole`
   * answers with the read-only floor — so one click silently demoted a whole
   * team, with no record of who had held what; and a code naming it could no
   * longer be redeemed at all (`assertValidRole`: Unknown role "Lead"). The
   * holders are moved first, deliberately, and then the role can go.
   */
  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    // role:manage first, as in create(): the counts below describe the
    // workspace's membership and must not be readable without it.
    await this.access.assertPermission(user, row.workspaceId, Permission.RoleManage);
    const scope = { workspaceId: row.workspaceId, role: row.name };
    const [members, codes] = await Promise.all([
      this.prisma.workspaceMember.count({ where: scope }),
      this.prisma.inviteCode.count({ where: scope }),
    ]);
    if (members > 0) {
      throw new ConflictException(
        `${members} ${members === 1 ? 'member holds' : 'members hold'} the "${row.name}" role. Give them another role first.`,
      );
    }
    if (codes > 0) {
      throw new ConflictException(
        `An invite code still hands out the "${row.name}" role. Delete that code first.`,
      );
    }
    return super.remove(user, id);
  }
}

@Injectable()
export class InviteCodesService extends ScopedCrudService<
  InviteCode,
  ReturnType<typeof inviteCodeResponse>
> {
  protected readonly model = 'inviteCode';
  protected readonly auditEntity = 'invite_code';
  protected readonly writePermission: PermissionKey = Permission.InviteManage;
  // The row IS the secret — anyone who can read `code` can join at its role.
  protected readonly readPermission: PermissionKey = Permission.InviteManage;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, role: { field: 'role' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: InviteCode) {
    return inviteCodeResponse(row);
  }
  /**
   * A code is only readable by somebody who could have minted it.
   *
   * `invite:manage` alone used to show every code in the workspace, the
   * Manager-level ones included, to an Assistant Manager or to a custom role
   * holding nothing else. Reading a code IS holding it: they could leave the
   * workspace and redeem it, or pass it to an account they control, and arrive
   * at a role the rank rule exists to keep from them. So the read scope is
   * narrowed, per workspace, to the roles the reader may grant.
   */
  protected override async readScope(user: User): Promise<Record<string, unknown>> {
    const scope = await super.readScope(user);
    if (this.access.isPlatformAdmin(user)) return scope;
    const ids = ((scope.workspaceId as { in?: string[] } | undefined)?.in ?? []) as string[];
    const grantable = await Promise.all(ids.map((id) => this.access.grantableRoles(user, id)));
    return {
      OR: [
        // Never matches: keeps the fragment well-formed when there is nothing to read.
        { workspaceId: { in: [] } },
        ...ids.map((id, i) => ({ workspaceId: id, role: { in: grantable[i] ?? [] } })),
      ],
    };
  }

  /** A code grants its role to whoever redeems it, so minting or re-pointing one
   *  is a role grant: `invite:manage` first (so an unauthorized caller still ends
   *  on the frozen DENY_MESSAGE), then the same rank rule as a direct add. */
  private async assertMayOffer(user: User, workspaceId: string, role: string): Promise<void> {
    await this.access.assertPermission(user, workspaceId, this.writePermission);
    await this.access.assertCanGrantRole(user, workspaceId, role);
  }

  async create(user: User, dto: CreateInviteCodeDto) {
    if (dto.role !== undefined) await this.access.assertValidRole(dto.workspaceId, dto.role);
    await this.assertMayOffer(user, dto.workspaceId, dto.role ?? 'MEMBER');
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      code: code(), // server-generated: a caller-chosen code defeats the CSPRNG
      role: dto.role ?? 'MEMBER',
      maxUses: dto.maxUses ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdById: user.id,
    });
  }
  async patch(user: User, id: string, dto: UpdateInviteCodeDto) {
    const data: Record<string, unknown> = {};
    if (dto.role !== undefined) {
      const existing = await this.findScoped(user, id);
      await this.access.assertValidRole(existing.workspaceId, dto.role);
      await this.assertMayOffer(user, existing.workspaceId, dto.role);
      data.role = dto.role;
    }
    // Raising a limit or pushing an expiry out brings a spent code back to
    // life, which is offering its role again — the same grant as minting it.
    if (dto.maxUses !== undefined || dto.expiresAt !== undefined) {
      const existing = await this.findScoped(user, id);
      await this.assertMayOffer(user, existing.workspaceId, existing.role);
    }
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    return this.update(user, id, data);
  }
}

/**
 * Base for a self-service request collection — today, join requests. Its author
 * is by definition NOT a member of the target workspace, so the plain membership
 * scope would hide their own row from them (and `assertPermission` would stop
 * them cancelling it). Reads are widened to "mine, anywhere" and cancellation
 * is allowed to the author; everything else stays `join:manage`.
 */
abstract class SelfServiceRequestService<
  TRow extends { workspaceId?: string; userId?: string },
  TResponse,
> extends ScopedCrudService<TRow, TResponse> {
  /** Reading somebody else's request is as privileged as deciding it: the queue
   *  names who wants in and why, and only `join:manage` acts on it. The author
   *  still reads their own row through the OR below — which is the only way they
   *  ever could, being a non-member of the workspace they are asking to join. */
  protected readonly readPermission: PermissionKey = Permission.JoinManage;

  protected override async readScope(user: User): Promise<Record<string, unknown>> {
    const scope = await super.readScope(user);
    if (this.access.isPlatformAdmin(user)) return scope;
    return { OR: [scope, { userId: user.id }] };
  }

  /** A request may only target a real workspace the caller is not already in —
   *  otherwise the row is unresolvable noise, or a duplicate of a membership. */
  protected async assertRequestable(user: User, workspaceId: string): Promise<{ name: string }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    if (await this.access.activeMembership(user.id, workspaceId)) {
      throw new BadRequestException('You are already a member of this workspace.');
    }
    return { name: workspace.name };
  }

  /** Cancelling one's own request needs no workspace permission: the author is
   *  not a member and so could never hold `join:manage` there. */
  override async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    if (row.userId !== user.id) {
      await this.access.assertPermission(user, this.workspaceOf(row), this.writePermission);
    }
    await this.delegate.delete({ where: { id } });
    // This override does not call super.remove, so the trail is appended here.
    await this.recordAudit(user, this.workspaceOf(row), 'deleted', id, row as Record<string, unknown>);
  }
}

/**
 * The states a join request may be moved to BY A PATCH — anything else wedges
 * it, because approve/reject refuse a request whose status is no longer PENDING.
 *
 * APPROVED is deliberately absent: this path never touches `workspaceMember`, so
 * marking a request approved here showed the requester an approved request that
 * granted no access AND permanently 400'd the real
 * `POST /join_requests/:id/approve`. Approval belongs to
 * JoinRequestApprovalService, which creates the membership in the same
 * transaction.
 */
const JOIN_REQUEST_STATUSES = new Set(['PENDING', 'REJECTED']);

@Injectable()
export class JoinRequestsService extends SelfServiceRequestService<
  JoinRequest,
  ReturnType<typeof joinRequestResponse>
> {
  protected readonly model = 'joinRequest';
  protected readonly auditEntity = 'join_request';
  protected readonly writePermission: PermissionKey = Permission.JoinManage;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: JoinRequest) {
    return joinRequestResponse(row);
  }
  /**
   * Fill in who is asking, and whether they are already in. `map` is
   * synchronous and JoinRequest has no relation to User, so both have to be
   * joined on afterwards — the mapper already emits the keys, and overwriting
   * an existing key keeps its position in the frozen field order.
   *
   * `alreadyMember` closes a gap the reconciliation in `closePendingJoinRequests`
   * cannot: every membership-creating path in THIS module settles the request in
   * the same commit, but `POST /users/invite` writes its own membership row, and
   * rows predating any of that are still sitting in the queue. Reporting the
   * fact is a read; deciding the request stays the manager's, so nothing is
   * mutated here.
   *
   * `previousRole` comes from the same read: somebody whose access was switched
   * off can ask back in, and the queue used to present them as a stranger —
   * pre-set to the read-only Member, so approving quietly demoted them.
   */
  private async hydrate(
    rows: ReturnType<typeof joinRequestResponse>[],
  ): Promise<ReturnType<typeof joinRequestResponse>[]> {
    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    if (ids.length === 0) return rows;
    const workspaceIds = [...new Set(rows.map((r) => r.workspaceId).filter(Boolean))];
    const [users, memberships] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true, avatar: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId: { in: workspaceIds }, userId: { in: ids } },
        select: { workspaceId: true, userId: true, role: true, status: true },
      }),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    // The two `in` lists cross-match, so key on the exact pair, not on either
    // half: a list can span workspaces (a platform admin, or an author reading
    // their own requests).
    const membershipOf = new Map(memberships.map((m) => [`${m.workspaceId}:${m.userId}`, m]));
    return rows.map((row) => {
      const u = byId.get(row.userId);
      const m = membershipOf.get(`${row.workspaceId}:${row.userId}`);
      // ACTIVE only, matching `assertRequestable` and the server's own notion of
      // membership: an INVITED or deactivated row grants nothing, so a request
      // alongside one is still a live question.
      const alreadyMember = m?.status === 'ACTIVE';
      const previousRole = m?.status === 'INACTIVE' ? m.role : null;
      return u
        ? {
            ...row,
            userName: u.name,
            userEmail: u.email,
            userAvatar: u.avatar,
            alreadyMember,
            previousRole,
          }
        : { ...row, alreadyMember, previousRole };
    });
  }
  override async list(user: User, query: Record<string, string | string[] | undefined>) {
    const page = await super.list(user, query);
    return { ...page, items: await this.hydrate(page.items) };
  }
  override async retrieve(user: User, id: string) {
    const [row] = await this.hydrate([await super.retrieve(user, id)]);
    return row;
  }
  /** Any authenticated user may request to join (they are not yet a member).
   *  Upsert, not create: the (workspaceId,userId) unique index otherwise turns a
   *  double submit — and any re-application after a rejection — into a 400. */
  async create(user: User, dto: CreateJoinRequestDto) {
    const workspace = await this.assertRequestable(user, dto.workspaceId);
    const message = dto.message ?? '';
    const key = { workspaceId_userId: { workspaceId: dto.workspaceId, userId: user.id } };
    // Read first only to know whether this OPENS a request: editing the message
    // on one already waiting must not notify the managers a second time.
    const before = await this.prisma.joinRequest.findUnique({
      where: key,
      select: { status: true },
    });
    const row = await this.prisma.joinRequest.upsert({
      where: key,
      create: { id: generateId(), workspaceId: dto.workspaceId, userId: user.id, message },
      update: { message, status: 'PENDING', handledById: null },
    });
    // A request nobody is told about waits until a manager happens to open the
    // tab. Post-commit, like every other event here.
    if (before?.status !== 'PENDING') {
      this.events.emit(WorkspaceEvents.JoinRequestCreated, {
        name: WorkspaceEvents.JoinRequestCreated,
        workspaceId: dto.workspaceId,
        payload: {
          workspaceId: dto.workspaceId,
          userId: user.id,
          requestId: row.id,
          requesterName: user.name || user.email,
          workspaceName: workspace.name,
        },
        occurredAt: new Date().toISOString(),
      });
    }
    return joinRequestResponse(row, user);
  }
  async patch(user: User, id: string, dto: UpdateJoinRequestDto) {
    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) {
      if (!JOIN_REQUEST_STATUSES.has(dto.status)) {
        throw new BadRequestException(`Unknown join request status "${dto.status}".`);
      }
      data.status = dto.status;
    }
    if (dto.handledBy !== undefined) data.handledById = dto.handledBy;
    const [row] = await this.hydrate([await this.update(user, id, data)]);
    return row;
  }
}
