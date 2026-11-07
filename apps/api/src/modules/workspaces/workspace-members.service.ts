import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { WorkspaceEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User, WorkspaceMember } from '@prisma/client';
import { ADMIN_CAPABILITIES } from '../authz/administration';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { CreateMemberDto, UpdateMemberDto } from './dto';
import { closePendingJoinRequests } from './join-request-sync';
import { memberResponse } from './mappers';

/** The only membership states the app renders and authorizes against. */
const MEMBER_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'INVITED']);

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

type MemberUser = Pick<User, 'email' | 'name' | 'phone' | 'avatar' | 'hasTempPassword'>;

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
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatar: true,
        hasTempPassword: true,
      },
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
    // "Has not signed in yet" is shown to whoever can do something about it —
    // re-issue the temporary password — and to nobody else: for everyone else
    // it is only a list of accounts still on a password that was sent by mail.
    const mayAct = new Map<string, boolean>();
    for (const workspaceId of new Set(items.map((m) => m.workspaceId))) {
      mayAct.set(workspaceId, await this.access.can(user, workspaceId, Permission.MemberUpdate));
    }
    return paginate(
      items.map((m) =>
        memberResponse(m, users.get(m.userId) ?? null, mayAct.get(m.workspaceId) === true),
      ),
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
   * INVITED is not a state a membership can be put BACK into.
   *
   * It means "this person has not accepted yet", which is a fact about the past,
   * not a switch. Applying it to somebody who had already joined revoked their
   * access completely — an INVITED row is not an `activeMembership`, so every
   * scoped read returned 404 or zero rows — while the save reported "Team member
   * updated successfully" and the directory showed a friendly yellow "Invited"
   * badge. Nothing on screen said they had been locked out.
   *
   * Revoking access is what INACTIVE is for, and it goes through the owner,
   * self-edit and last-manager guards below like any other deactivation. The UI
   * already hides the option for a member who has joined; this is the same rule
   * for anything talking to the API directly.
   */
  private assertNotReInviting(existing: WorkspaceMember, next: string | undefined): void {
    if (next !== 'INVITED' || existing.status === 'INVITED') return;
    throw new BadRequestException(
      'This person has already joined, so their membership cannot go back to "Invited". ' +
        'Use "Inactive" to revoke their access.',
    );
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
    if (await this.isOwnersMembership(existing)) {
      throw new ForbiddenException(`The workspace owner cannot be ${verb}.`);
    }
  }

  /**
   * The owner's role is nobody else's to move — in ANY direction.
   *
   * `assertNotOwner` only fires on a change that costs privilege, and a sideways
   * move costs none on paper: a manager who was not the owner minted "Boss"
   * holding everything, moved the owner onto it (nothing lost, so no guard),
   * then cut Boss down to the read-only floor through the roles screen. The
   * owner was left powerless and the manager in charge. Moving the owner to a
   * custom role is what made the second step possible, so the move itself is
   * reserved, like every other change to the owner's membership, for a
   * platform administrator. The owner cannot do it either: nobody edits their
   * own role (`assertNotSelfEdit`) — they hand the workspace over first.
   */
  private async assertOwnerRoleUntouched(user: User, existing: WorkspaceMember): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    if (await this.isOwnersMembership(existing)) {
      throw new ForbiddenException(
        'The workspace owner’s role can only be changed by a platform administrator.',
      );
    }
  }

  private async isOwnersMembership(m: WorkspaceMember): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: m.workspaceId },
      select: { ownerId: true },
    });
    return workspace !== null && workspace.ownerId === m.userId;
  }

  /** Which of ADMIN_CAPABILITIES a role name resolves to in this workspace. */
  private async capabilitiesOf(workspaceId: string, role: string): Promise<Set<PermissionKey>> {
    const set = await this.access.permissionsOfRole(workspaceId, role);
    return new Set(ADMIN_CAPABILITIES.filter((p) => set.has('*') || set.has(p)));
  }

  /**
   * A workspace must never be left without an ACTIVE holder of a capability it
   * has now. Shared by `update` (privilege-reducing role change / deactivation),
   * `remove` and `leave`, which produce the same orphaned-workspace outcome —
   * access is decided by `status: 'ACTIVE'` and `role`, so demoting or
   * deactivating the last administrator is a removal by another name.
   *
   * The question is asked of the workspace as the write will leave it
   * (`capabilitiesOrphanedBy`), the same one a role-definition edit asks, and by
   * CAPABILITY: counting `role: 'MANAGER'` literals gave a workspace
   * administered entirely through a custom role no protection at all.
   */
  private async assertRetainsCapabilities(
    user: User,
    existing: WorkspaceMember,
    /** The role the membership will hold; null when it stops counting. */
    nextRole: string | null,
    verb: 'removed' | 'demoted',
    /** What to say instead, when the change is the member's own doing. */
    message?: string,
  ): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    const orphaned = await this.access.capabilitiesOrphanedBy(existing.workspaceId, {
      membershipId: existing.id,
      role: nextRole,
    });
    if (orphaned.length) {
      throw new ForbiddenException(message ?? `The last manager of a workspace cannot be ${verb}.`);
    }
  }

  /** The administrative capabilities a membership change costs the workspace.
   *  Empty for a promotion or a sideways move, which is why those must not trip
   *  the orphan guards — firing them on every `dto.role !== existing.role` made
   *  a workspace whose owner is not a MANAGER impossible to repair. (A change to
   *  the OWNER's role is refused on its own terms: assertOwnerRoleUntouched.) */
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
    await this.access.assertCanGrantRole(user, dto.workspaceId, dto.role ?? 'MEMBER');
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
      actorId: user.id,
    });
    return this.withUser(m);
  }

  async update(user: User, id: string, dto: UpdateMemberDto) {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.MemberUpdate);
    if (dto.role !== undefined) await this.access.assertValidRole(existing.workspaceId, dto.role);
    if (dto.status !== undefined) this.assertValidStatus(dto.status);
    this.assertNotReInviting(existing, dto.status);
    // A role change, or any move off ACTIVE, can orphan the workspace exactly
    // as a removal does — so it runs the same owner/self/last-manager guards.
    const changesRole = dto.role !== undefined && dto.role !== existing.role;
    const changesStatus = dto.status !== undefined && dto.status !== existing.status;
    const deactivates = changesStatus && dto.status !== 'ACTIVE';
    // Rank, in both directions: the member being changed must not outrank the
    // caller (a reactivation hands their role back, so it counts), and the role
    // being handed over must not either.
    if (changesRole || changesStatus) {
      await this.access.assertNotOutranked(user, existing.workspaceId, existing.role);
    }
    if (changesRole) {
      await this.access.assertCanGrantRole(user, existing.workspaceId, dto.role as string);
    }
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
        await this.assertRetainsCapabilities(
          user,
          existing,
          deactivates ? null : (dto.role ?? existing.role),
          'demoted',
        );
      }
      // A sideways move or a promotion costs nothing above — but on the owner
      // it is still somebody else deciding the owner's role.
      if (changesRole) await this.assertOwnerRoleUntouched(user, existing);
    }
    const data: Prisma.WorkspaceMemberUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    const updated = await this.prisma.workspaceMember.update({ where: { id }, data });
    // Switched off: a timer they had running here can no longer be stopped —
    // stopping files the time in this workspace, which now refuses them — and
    // a person holds one timer at a time, so it blocked their timers in every
    // other workspace too.
    if (deactivates) await this.dropTimerIn(updated.workspaceId, updated.userId);
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
    if (changesStatus) {
      // The person is told — see WorkNotificationSubscriber. Losing access used
      // to be something they found out by trying to open the workspace.
      this.emit(WorkspaceEvents.MemberStatusChanged, updated.workspaceId, {
        workspaceId: updated.workspaceId,
        userId: updated.userId,
        status: updated.status,
        previousStatus: existing.status,
        actorId: user.id,
      });
    }
    if (dto.role !== undefined && dto.role !== existing.role) {
      this.emit(WorkspaceEvents.MemberRoleChanged, updated.workspaceId, {
        workspaceId: updated.workspaceId,
        userId: updated.userId,
        role: updated.role,
        previousRole: existing.role,
        actorId: user.id,
      });
    }
    return this.withUser(updated);
  }

  /**
   * What a member leaves behind if removed, for the dialog that asks first:
   * open tasks still assigned to them, leave waiting on a decision, hours
   * waiting on approval. "This action cannot be undone" was all it said.
   */
  async footprint(
    user: User,
    id: string,
  ): Promise<{ openTasks: number; pendingLeave: number; pendingTime: number }> {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.MemberRemove);
    const [openTasks, pendingLeave, pendingTime] = await Promise.all([
      this.openTasksOf(existing.workspaceId, existing.userId).then((tasks) => tasks.length),
      this.prisma.leaveRequest.count({
        where: { workspaceId: existing.workspaceId, userId: existing.userId, status: 'PENDING' },
      }),
      this.prisma.timeEntry.count({
        where: { workspaceId: existing.workspaceId, userId: existing.userId, status: 'PENDING' },
      }),
    ]);
    return { openTasks, pendingLeave, pendingTime };
  }

  /** Unfinished tasks in a workspace that name this person among their assignees. */
  private async openTasksOf(workspaceId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId,
        status: { not: 'DONE' },
        assigneeIds: { array_contains: [userId] },
      },
      select: { id: true, assigneeIds: true, assigneeNames: true },
    });
    return tasks;
  }

  /**
   * Drop the person's running timer if it is running for THIS workspace.
   *
   * A timer is filed into the workspace it was started for, and filing asks for
   * `hr:write` there — which somebody removed or switched off no longer has. So
   * the timer could never be stopped, and since a person holds one timer at a
   * time, they could not start one in any other workspace either. The time on it
   * is not filed: it would land in front of approvers of a workspace the person
   * is no longer part of. A timer for another workspace is theirs to keep.
   *
   * Conditional on the row still being there — the person may stop it in the
   * same moment — and announced, because `deleteMany` is invisible to the write
   * hook and their own open timer would otherwise keep ticking on screen.
   */
  private async dropTimerIn(workspaceId: string, userId: string): Promise<void> {
    const timer = await this.prisma.activeTimer.findUnique({ where: { userId } });
    if (!timer || timer.workspaceId !== workspaceId) return;
    const { count } = await this.prisma.activeTimer.deleteMany({
      where: { id: timer.id, workspaceId },
    });
    if (count > 0) this.prisma.announceWrite?.('ActiveTimer', 'delete', timer);
  }

  /** One person taken off an assignee list, and off its index-aligned names. */
  private static withoutAssignee(
    row: { assigneeIds: unknown; assigneeNames: unknown },
    userId: string,
  ): { assigneeIds: string[]; assigneeNames: string[] } {
    const ids = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    const names = ids(row.assigneeNames);
    const before = ids(row.assigneeIds);
    // Names line up with ids where both were written together; when they do
    // not, fall back to dropping none rather than the wrong one.
    return {
      assigneeIds: before.filter((assignee) => assignee !== userId),
      assigneeNames:
        names.length === before.length ? names.filter((_, i) => before[i] !== userId) : names,
    };
  }

  /**
   * After a removal: their requests for leave are withdrawn — nobody is going
   * to take that leave, and approving it charged a balance in a workspace they
   * have left (the card read "Unknown User") — and they come off the tasks
   * and requirements still open, which otherwise named somebody no picker
   * lists. Hours already logged stay in the approval queue: they were worked.
   */
  private async tidyAfterRemoval(workspaceId: string, userId: string): Promise<void> {
    await this.dropTimerIn(workspaceId, userId);
    const pending = await this.prisma.leaveRequest.findMany({
      where: { workspaceId, userId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending.length) {
      await this.prisma.leaveRequest.updateMany({
        where: { id: { in: pending.map((r) => r.id) }, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      for (const row of await this.prisma.leaveRequest.findMany({
        where: { id: { in: pending.map((r) => r.id) } },
      })) {
        this.prisma.announceWrite?.('LeaveRequest', 'update', row);
      }
    }
    for (const task of await this.openTasksOf(workspaceId, userId)) {
      // `update`, not `updateMany`: one write per task, each seen by the write
      // hook, so open boards redraw.
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          ...WorkspaceMembersService.withoutAssignee(task, userId),
          version: { increment: 1 },
        },
      });
    }
    // Requirements carry their own assignee list. Left alone, a requirement
    // went on naming somebody the workspace no longer has — in its card, its
    // filters and its notices. A DEPLOYED one is signed off and keeps its
    // record of who delivered it, as a DONE task does.
    const requirements = await this.prisma.functionalRequirement.findMany({
      where: {
        workspaceId,
        status: { not: 'DEPLOYED' },
        assigneeIds: { array_contains: [userId] },
      },
      select: { id: true, assigneeIds: true, assigneeNames: true },
    });
    for (const fr of requirements) {
      await this.prisma.functionalRequirement.update({
        where: { id: fr.id },
        data: {
          ...WorkspaceMembersService.withoutAssignee(fr, userId),
          version: { increment: 1 },
        },
      });
    }
  }

  async remove(user: User, id: string): Promise<void> {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.MemberRemove);
    this.assertNotSelfEdit(user, existing, 'removed');
    await this.access.assertNotOutranked(user, existing.workspaceId, existing.role);
    // Removal is an identity question for the owner and a capability question
    // for everyone else, so both guards run unconditionally here.
    await this.assertNotOwner(user, existing, 'removed');
    await this.assertRetainsCapabilities(user, existing, null, 'removed');
    await this.prisma.workspaceMember.delete({ where: { id } });
    await this.tidyAfterRemoval(existing.workspaceId, existing.userId);
    this.emit(WorkspaceEvents.MemberRemoved, existing.workspaceId, {
      workspaceId: existing.workspaceId,
      userId: existing.userId,
      role: existing.role,
      via: 'direct',
      actorId: user.id,
    });
  }

  /**
   * Leave a workspace: the caller ends their OWN membership.
   *
   * There was no way to. `remove` takes `member:remove` and refuses the caller's
   * own row, both rightly — it is how somebody ELSE is taken out — so a person
   * added to a workspace by mistake, or finished with a project, stayed on its
   * roster and in its notifications until a manager happened to remove them.
   *
   * Two memberships cannot be walked away from. The owner's, because the
   * workspace is theirs: it is deleted, not left. And the last one that can
   * administer it, for the reason `remove` refuses the same thing — the
   * workspace would be left with nobody able to manage it.
   */
  async leave(user: User, workspaceId: string): Promise<void> {
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Not found.');
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    // By identity, and with no platform-admin exemption: that exemption exists
    // so an admin can REPAIR an owner's membership, not so the owner can vanish.
    if (workspace?.ownerId === user.id) {
      throw new ForbiddenException(
        'You own this workspace, so you cannot leave it. Delete it if it is no longer needed.',
      );
    }
    // Only a membership in good standing can be walked away from. A manager
    // who switched somebody's access off made a decision, and leaving deleted
    // the row that recorded it: the same person could then redeem an invite
    // code and be ACTIVE again a moment later.
    if (existing.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Your access to this workspace is switched off. One of its managers has to remove you or switch it back on.',
      );
    }
    await this.assertRetainsCapabilities(
      user,
      existing,
      null,
      'removed',
      'You are the last manager of this workspace. Make somebody else a manager before you leave.',
    );
    await this.prisma.workspaceMember.delete({ where: { id: existing.id } });
    // As a removal does: leave still waiting on an approver is withdrawn, and the
    // open tasks they held go back to the pool — or the boards went on naming
    // somebody who was no longer there.
    await this.tidyAfterRemoval(workspaceId, user.id);
    this.emit(WorkspaceEvents.MemberRemoved, workspaceId, {
      workspaceId,
      userId: user.id,
      role: existing.role,
      via: 'left',
      actorId: user.id,
    });
  }

  private emit(name: string, workspaceId: string, payload: Record<string, unknown>): void {
    this.events.emit(name, { name, workspaceId, payload, occurredAt: new Date().toISOString() });
  }
}
