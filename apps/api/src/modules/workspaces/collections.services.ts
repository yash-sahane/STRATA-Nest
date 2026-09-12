import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { generateId, type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type {
  EmailInvitation,
  InviteCode,
  JoinRequest,
  PendingWorkspaceAccess,
  Prisma,
  User,
  WorkspaceRole,
} from '@prisma/client';
import { PERMISSION_KEYS, Permission, isBuiltInRole, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type {
  CreateEmailInvitationDto,
  CreateInviteCodeDto,
  CreateJoinRequestDto,
  CreatePendingAccessDto,
  CreateRoleDto,
  UpdateEmailInvitationDto,
  UpdateInviteCodeDto,
  UpdateJoinRequestDto,
  UpdatePendingAccessDto,
  UpdateRoleDto,
} from './dto';
import {
  emailInvitationResponse,
  inviteCodeResponse,
  joinRequestResponse,
  pendingAccessResponse,
  roleResponse,
} from './mappers';
import { ScopedCrudService } from './scoped-crud.base';

const token = () => randomBytes(24).toString('base64url');
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

  async create(user: User, dto: CreateRoleDto) {
    // role:manage FIRST, so an unauthorized caller always terminates on the
    // frozen DENY_MESSAGE. The checks below throw with detail (the escalating
    // permission names), which is an enumeration oracle for the workspace's
    // whole RBAC configuration if it can be reached without the permission.
    await this.access.assertPermission(user, dto.workspaceId, Permission.RoleManage);
    this.assertNotBuiltIn(dto.name);
    await this.assertGrantable(user, dto.workspaceId, dto.permissions ?? []);
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      name: dto.name,
      permissions: dto.permissions ?? [],
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
      await this.assertGrantable(user, existing.workspaceId, dto.permissions);
      data.permissions = dto.permissions;
    }
    // Every row that stores the role by NAME follows it, in the SAME transaction
    // as the rename itself. Refusing the rename while the name was in use only
    // ever covered memberships, and left invite codes / e-mail invitations /
    // pending-access rows naming a role that no longer exists — `assertValidRole`
    // then 400s the acceptance with `Unknown role "Lead"`, permanently bricking
    // the invite with a message pointing at a role the inviter can no longer see.
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
        this.prisma.emailInvitation.updateMany({ where: scope, data: { role: rename.to } }),
        this.prisma.pendingWorkspaceAccess.updateMany({
          where: { workspaceId: rename.workspaceId, requestedRole: rename.from },
          data: { requestedRole: rename.to },
        }),
      ]);
      return this.map(row);
    }
    return this.update(user, id, data);
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
  async create(user: User, dto: CreateInviteCodeDto) {
    if (dto.role !== undefined) await this.access.assertValidRole(dto.workspaceId, dto.role);
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
      data.role = dto.role;
    }
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    return this.update(user, id, data);
  }
}

@Injectable()
export class EmailInvitationsService extends ScopedCrudService<
  EmailInvitation,
  ReturnType<typeof emailInvitationResponse>
> {
  protected readonly model = 'emailInvitation';
  protected readonly auditEntity = 'email_invitation';
  protected readonly writePermission: PermissionKey = Permission.InviteManage;
  // A pending invitation carries its acceptance token and names who is being
  // brought in; a read-only member has no business seeing either.
  protected readonly readPermission: PermissionKey = Permission.InviteManage;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      email: { field: 'email' },
      status: { field: 'status' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: EmailInvitation) {
    return emailInvitationResponse(row);
  }
  async create(user: User, dto: CreateEmailInvitationDto) {
    if (dto.role !== undefined) await this.access.assertValidRole(dto.workspaceId, dto.role);
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      email: dto.email.toLowerCase(),
      role: dto.role ?? 'MEMBER',
      token: token(), // server-generated: a caller-chosen token is guessable
      status: 'PENDING', // transitions belong to patch() and the accept workflow
      expiresAt: new Date(dto.expiresAt),
      invitedById: user.id,
    });
  }
  async patch(user: User, id: string, dto: UpdateEmailInvitationDto) {
    const data: Record<string, unknown> = {};
    if (dto.role !== undefined) {
      const existing = await this.findScoped(user, id);
      await this.access.assertValidRole(existing.workspaceId, dto.role);
      data.role = dto.role;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);
    return this.update(user, id, data);
  }
}

/**
 * Base for the two self-service request collections. Their author is by
 * definition NOT a member of the target workspace, so the plain membership
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
  protected async assertRequestable(user: User, workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    if (await this.access.activeMembership(user.id, workspaceId)) {
      throw new BadRequestException('You are already a member of this workspace.');
    }
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
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
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
      // ACTIVE only, matching `assertRequestable` and the server's own notion of
      // membership: an INVITED or deactivated row grants nothing, so a request
      // alongside one is still a live question.
      this.prisma.workspaceMember.findMany({
        where: { status: 'ACTIVE', workspaceId: { in: workspaceIds }, userId: { in: ids } },
        select: { workspaceId: true, userId: true },
      }),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    // The two `in` lists cross-match, so key on the exact pair, not on either
    // half: a list can span workspaces (a platform admin, or an author reading
    // their own requests).
    const joined = new Set(memberships.map((m) => `${m.workspaceId}:${m.userId}`));
    return rows.map((row) => {
      const u = byId.get(row.userId);
      const alreadyMember = joined.has(`${row.workspaceId}:${row.userId}`);
      return u
        ? { ...row, userName: u.name, userEmail: u.email, userAvatar: u.avatar, alreadyMember }
        : { ...row, alreadyMember };
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
    await this.assertRequestable(user, dto.workspaceId);
    const message = dto.message ?? '';
    const row = await this.prisma.joinRequest.upsert({
      where: { workspaceId_userId: { workspaceId: dto.workspaceId, userId: user.id } },
      create: { id: generateId(), workspaceId: dto.workspaceId, userId: user.id, message },
      update: { message, status: 'PENDING', handledById: null },
    });
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

@Injectable()
export class PendingAccessService extends SelfServiceRequestService<
  PendingWorkspaceAccess,
  ReturnType<typeof pendingAccessResponse>
> {
  protected readonly model = 'pendingWorkspaceAccess';
  protected readonly auditEntity = 'pending_access';
  protected readonly writePermission: PermissionKey = Permission.JoinManage;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, userId: { field: 'userId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: PendingWorkspaceAccess) {
    return pendingAccessResponse(row);
  }
  /** Upsert on (workspaceId,userId): the collection previously appended a new
   *  row on every submit and grew without bound. */
  async create(user: User, dto: CreatePendingAccessDto) {
    await this.assertRequestable(user, dto.workspaceId);
    const requestedRole = dto.requestedRole ?? 'MEMBER';
    await this.access.assertValidRole(dto.workspaceId, requestedRole);
    const row = await this.prisma.pendingWorkspaceAccess.upsert({
      where: { workspaceId_userId: { workspaceId: dto.workspaceId, userId: user.id } },
      create: { id: generateId(), workspaceId: dto.workspaceId, userId: user.id, requestedRole },
      update: { requestedRole },
    });
    return pendingAccessResponse(row);
  }
  async patch(user: User, id: string, dto: UpdatePendingAccessDto) {
    const data: Record<string, unknown> = {};
    if (dto.requestedRole !== undefined) {
      const existing = await this.findScoped(user, id);
      await this.access.assertValidRole(existing.workspaceId, dto.requestedRole);
      data.requestedRole = dto.requestedRole;
    }
    return this.update(user, id, data);
  }
}
