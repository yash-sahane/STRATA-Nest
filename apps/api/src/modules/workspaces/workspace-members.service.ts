import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { WorkspaceEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User, WorkspaceMember } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { CreateMemberDto, UpdateMemberDto } from './dto';
import { closePendingJoinRequests } from './join-request-sync';
import { memberResponse } from './mappers';

/** The only membership states the app renders and authorizes against. */
const MEMBER_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'INVITED']);

/**
 * The capabilities a workspace must never lose its last holder of.
 *
 * `member:update` alone was not enough: MANAGER → ASSISTANT_MANAGER keeps it
 * (ASSISTANT_MANAGER is `ALL` minus `workspace:delete`), so a role change that
 * strips the workspace of every actor able to delete it read as "no capacity
 * lost" and skipped both the owner guard and the last-admin count. Tracking
 * `workspace:delete` separately makes the demotion of the last MANAGER — and of
 * the owner — visible as the privilege loss it is.
 */
const ADMIN_CAPABILITIES: readonly PermissionKey[] = [
  Permission.MemberUpdate,
  Permission.WorkspaceDelete,
];

const SPEC: ListQuerySpec = {
  filterable: {
    workspaceId: { field: 'workspaceId' },
    userId: { field: 'userId' },
    role: { field: 'role' },
    status: { field: 'status' },
  },
  sortable: { createdAt: 'createdAt', joinedAt: 'joinedAt' },
  defaultOrderBy: { createdAt: 'desc' },
};

type MemberUser = Pick<User, 'email' | 'name' | 'phone' | 'avatar'>;

@Injectable()
export class WorkspaceMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  private async usersFor(members: WorkspaceMember[]): Promise<Map<string, MemberUser>> {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, email: true, name: true, phone: true, avatar: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof memberResponse>>> {
    const scope = await this.access.scopeWhere(user);
    const parsed = parseListQuery(query, SPEC);
    const where: Prisma.WorkspaceMemberWhereInput = {
      AND: [scope, parsed.where as Prisma.WorkspaceMemberWhereInput],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspaceMember.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.WorkspaceMemberOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.workspaceMember.count({ where }),
    ]);
    const users = await this.usersFor(items);
    return paginate(
      items.map((m) => memberResponse(m, users.get(m.userId) ?? null)),
      total,
      parsed.page,
      parsed.pageSize,
    );
  }

  private async findScoped(user: User, id: string): Promise<WorkspaceMember> {
    const scope = await this.access.scopeWhere(user);
    const m = await this.prisma.workspaceMember.findFirst({ where: { AND: [scope, { id }] } });
    if (!m) throw new NotFoundException('Not found.');
    return m;
  }

  private async withUser(m: WorkspaceMember) {
    const users = await this.usersFor([m]);
    return memberResponse(m, users.get(m.userId) ?? null);
  }

  private assertValidStatus(status: string): void {
    if (!MEMBER_STATUSES.has(status)) {
      throw new BadRequestException(`Unknown membership status "${status}".`);
    }
  }

  /**
   * Nobody edits their own role or status — in EITHER direction. A demotion is
   * an orphaning risk; a promotion is a straight escalation for anyone holding
   * `member:update` through a custom role. Deliberately not exempted for
   * platform admins: they have no need to route power through a membership row.
   */
  private assertNotSelfEdit(
    user: User,
    existing: WorkspaceMember,
    verb: 'removed' | 'demoted',
  ): void {
    if (existing.userId !== user.id) return;
    throw new ForbiddenException(
      verb === 'removed'
        ? 'You cannot remove your own membership.'
        : 'You cannot change your own role or status.',
    );
  }

  /**
   * The workspace owner's membership is protected by IDENTITY, not by label — so
   * this runs on every change that costs them privilege, whatever role name the
   * change happens to use.
   *
   * Platform admins are exempt: they are the only actor left when a workspace
   * has already lost its manager (a legacy-label migration, a bad import), and
   * without the exemption the repair — promoting the owner's membership back to
   * MANAGER — was refused as "the workspace owner cannot be demoted", leaving
   * the tenant permanently unmanageable short of direct DB access.
   */
  private async assertNotOwner(
    user: User,
    existing: WorkspaceMember,
    verb: 'removed' | 'demoted',
  ): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: existing.workspaceId },
      select: { ownerId: true },
    });
    if (workspace && existing.userId === workspace.ownerId) {
      throw new ForbiddenException(`The workspace owner cannot be ${verb}.`);
    }
  }

  /** Every role name that exists in this workspace — the built-in map plus the
   *  workspace's own custom roles. Needed because the last-admin question is
   *  about CAPABILITY: counting `role: 'MANAGER'` literals gave a workspace
   *  administered entirely through a custom role no protection at all. */
  private async rolesHolding(workspaceId: string, permission: PermissionKey): Promise<string[]> {
    const custom = await this.prisma.workspaceRole.findMany({
      where: { workspaceId },
      select: { name: true },
    });
    const names = [
      ...new Set([...Object.keys(ROLE_PERMISSIONS), ...custom.map((r) => r.name)]),
    ];
    const sets = await Promise.all(
      names.map((name) => this.access.permissionsOfRole(workspaceId, name)),
    );
    return names.filter((_, i) => sets[i].has('*') || sets[i].has(permission));
  }

  /** Which of ADMIN_CAPABILITIES a role name resolves to in this workspace. */
  private async capabilitiesOf(workspaceId: string, role: string): Promise<Set<PermissionKey>> {
    const set = await this.access.permissionsOfRole(workspaceId, role);
    return new Set(ADMIN_CAPABILITIES.filter((p) => set.has('*') || set.has(p)));
  }

  /**
   * A workspace must never be left without a holder of a capability this change
   * takes away. Shared by `update` (privilege-reducing role change /
   * deactivation) and `remove`, which produce the same orphaned-workspace
   * outcome — access is decided by `status: 'ACTIVE'` and `role`, so demoting or
   * deactivating the last administrator is a removal by another name.
   */
  private async assertRetainsCapabilities(
    user: User,
    existing: WorkspaceMember,
    lost: PermissionKey[],
    verb: 'removed' | 'demoted',
  ): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    for (const permission of lost) {
      const roles = await this.rolesHolding(existing.workspaceId, permission);
      const others = await this.prisma.workspaceMember.count({
        where: {
          workspaceId: existing.workspaceId,
          role: { in: roles },
          status: 'ACTIVE',
          id: { not: existing.id },
        },
      });
      if (others === 0) {
        throw new ForbiddenException(`The last manager of a workspace cannot be ${verb}.`);
      }
    }
  }

  /** The administrative capabilities a membership change costs the workspace.
   *  Empty for a promotion or a sideways move, which is why those must not trip
   *  the orphan guards — firing them on every `dto.role !== existing.role` made
   *  a workspace whose owner is not a MANAGER impossible to repair. */
  private async capabilitiesLost(
    existing: WorkspaceMember,
    nextRole: string | undefined,
    deactivates: boolean,
  ): Promise<PermissionKey[]> {
    const before = await this.capabilitiesOf(existing.workspaceId, existing.role);
    if (deactivates) return [...before]; // an inactive membership carries none
    const after = await this.capabilitiesOf(existing.workspaceId, nextRole ?? existing.role);
    return [...before].filter((p) => !after.has(p));
  }

  async retrieve(user: User, id: string) {
    return this.withUser(await this.findScoped(user, id));
  }

  async create(user: User, dto: CreateMemberDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.MemberInvite);
    if (dto.role !== undefined) await this.access.assertValidRole(dto.workspaceId, dto.role);
    if (dto.status !== undefined) this.assertValidStatus(dto.status);
    const status = dto.status ?? 'ACTIVE';
    const created = this.prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: dto.workspaceId,
        userId: dto.userId,
        role: dto.role ?? 'MEMBER',
        status,
      },
    });
    // Adding somebody directly ANSWERS the request they had raised to join, so
    // it is settled in the same commit — leaving it PENDING left the manager an
    // approve/decline decision about a member they had just created. Only when
    // the membership is ACTIVE, though: an INVITED row grants no access yet, so
    // that person's request is still a live question.
    const m =
      status === 'ACTIVE'
        ? (
            await this.prisma.$transaction([
              created,
              closePendingJoinRequests(this.prisma, dto.workspaceId, dto.userId, user.id),
            ])
          )[0]
        : await created;
    this.emit(WorkspaceEvents.MemberAdded, m.workspaceId, {
      workspaceId: m.workspaceId,
      userId: m.userId,
      role: m.role,
      via: 'direct',
    });
    return this.withUser(m);
  }

  async update(user: User, id: string, dto: UpdateMemberDto) {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.MemberUpdate);
    if (dto.role !== undefined) await this.access.assertValidRole(existing.workspaceId, dto.role);
    if (dto.status !== undefined) this.assertValidStatus(dto.status);
    // A role change, or any move off ACTIVE, can orphan the workspace exactly
    // as a removal does — so it runs the same owner/self/last-manager guards.
    const changesRole = dto.role !== undefined && dto.role !== existing.role;
    const deactivates =
      dto.status !== undefined && dto.status !== existing.status && dto.status !== 'ACTIVE';
    if (changesRole || deactivates) {
      // Always: an edit of one's own membership, up or down.
      this.assertNotSelfEdit(user, existing, 'demoted');
      // Only when the change actually costs the workspace a capability. Note the
      // set is derived from the RESOLVED permissions of both roles, so a custom
      // role minted to look harmless ("Ghost" holding only `member:update`) is
      // still recognised as stripping `workspace:delete`.
      const lost = await this.capabilitiesLost(existing, dto.role, deactivates);
      if (lost.length || deactivates) {
        await this.assertNotOwner(user, existing, 'demoted');
        await this.assertRetainsCapabilities(user, existing, lost, 'demoted');
      }
    }
    const data: Prisma.WorkspaceMemberUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    const updated = await this.prisma.workspaceMember.update({ where: { id }, data });
    // Reactivation is a grant of access like any other: an INACTIVE member is
    // not an `activeMembership`, so they CAN raise a join request, and turning
    // them back on has to settle it.
    if (dto.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
      await closePendingJoinRequests(
        this.prisma,
        updated.workspaceId,
        updated.userId,
        user.id,
      );
    }
    if (dto.role !== undefined && dto.role !== existing.role) {
      this.emit(WorkspaceEvents.MemberRoleChanged, updated.workspaceId, {
        workspaceId: updated.workspaceId,
        userId: updated.userId,
        role: updated.role,
        previousRole: existing.role,
      });
    }
    return this.withUser(updated);
  }

  async remove(user: User, id: string): Promise<void> {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.MemberRemove);
    this.assertNotSelfEdit(user, existing, 'removed');
    // Removal is an identity question for the owner and a capability question
    // for everyone else, so both guards run unconditionally here.
    await this.assertNotOwner(user, existing, 'removed');
    await this.assertRetainsCapabilities(
      user,
      existing,
      [...(await this.capabilitiesOf(existing.workspaceId, existing.role))],
      'removed',
    );
    await this.prisma.workspaceMember.delete({ where: { id } });
    this.emit(WorkspaceEvents.MemberRemoved, existing.workspaceId, {
      workspaceId: existing.workspaceId,
      userId: existing.userId,
      role: existing.role,
      via: 'direct',
    });
  }

  private emit(name: string, workspaceId: string, payload: Record<string, unknown>): void {
    this.events.emit(name, { name, workspaceId, payload, occurredAt: new Date().toISOString() });
  }
}
