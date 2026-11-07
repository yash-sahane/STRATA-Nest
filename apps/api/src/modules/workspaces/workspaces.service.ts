import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { WorkspaceEvents, type WorkspaceMemberAddedPayload } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { UsersService } from '../users/users.service';
import { tellPeople } from '../notifications/notice';
import type { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto';
import { workspaceResponse } from './mappers';
import {
  businessDayMarker,
  businessTimezone,
  parseWorkspaceSettings,
  settingsToStore,
  todayIn,
  workingWeekOf,
  type WorkspaceSettings,
  type WorkspaceSettingsInput,
} from '@strata/config';
import { lockCalendar } from '../leave/calendar-lock';
import {
  reconcileWorkingWeekChange,
  sameWorkingWeekFrom,
  type CalendarReconciliation,
} from '../leave/holiday-reconcile';

/** A working-week change re-counts every Saturday it flips, up to the furthest
 *  leave on record: more than an interactive transaction's default five seconds. */
const CALENDAR_TRANSACTION = { maxWait: 10_000, timeout: 120_000 };

const SPEC: ListQuerySpec = {
  filterable: { name: { field: 'name' }, ownerId: { field: 'ownerId' } },
  sortable: { createdAt: 'createdAt', name: 'name' },
  defaultOrderBy: { createdAt: 'desc' },
};

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
    private readonly users: UsersService,
  ) {}

  private async memberIds(workspaceIds: string[]): Promise<Map<string, string[]>> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { workspaceId: true, userId: true },
    });
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.workspaceId) ?? [];
      list.push(r.userId);
      map.set(r.workspaceId, list);
    }
    return map;
  }

  /**
   * Workspaces the caller could ask to join — id and name only.
   *
   * `list()` is scoped to workspaces you are already in, which is correct for
   * every other screen but made POST /join_requests unusable: it requires a
   * `workspaceId` and nothing let a non-member discover one, so the whole
   * request-to-join flow was unreachable from the client.
   *
   * DISCLOSURE: this deliberately shows workspace NAMES to any authenticated
   * user, which is what a request-access flow requires. Nothing else is
   * exposed — no members, no settings, no counts — and workspaces the caller
   * already belongs to are filtered out, so it reveals only "these are the
   * teams you could ask to join".
   */
  async directory(user: User): Promise<
    Array<{ id: string; name: string; requested: boolean; accessSwitchedOff?: true; declinedAt?: string }>
  > {
    const [memberships, requests] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { workspaceId: true, status: true },
      }),
      // One row per person and workspace: its status is the latest word on it.
      this.prisma.joinRequest.findMany({
        where: { userId: user.id },
        select: { workspaceId: true, status: true, updatedAt: true },
      }),
    ]);
    const active = new Set(memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.workspaceId));
    // A switched-off membership used to hide the workspace from this list as
    // if the person were still in it — while a request from them is exactly
    // what a manager needs to switch them back on.
    const switchedOff = new Set(
      memberships.filter((m) => m.status !== 'ACTIVE').map((m) => m.workspaceId),
    );
    const request = new Map(requests.map((r) => [r.workspaceId, r]));

    const rows = await this.prisma.workspace.findMany({
      where: { id: { notIn: [...active] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    // `requested` lets the client disable a workspace the user has already
    // asked about rather than letting them queue duplicates the API refuses.
    // `declinedAt` says the last request was declined: the screen went on
    // reading "awaiting a decision", or showed the workspace as if never asked.
    return rows.map((w) => {
      const latest = request.get(w.id);
      return {
        ...w,
        requested: latest?.status === 'PENDING',
        ...(switchedOff.has(w.id) ? { accessSwitchedOff: true as const } : {}),
        ...(latest?.status === 'REJECTED' ? { declinedAt: latest.updatedAt.toISOString() } : {}),
      };
    });
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof workspaceResponse>>> {
    const scope = await this.access.scopeWhere(user, 'id'); // Workspace is scoped by its own id
    const parsed = parseListQuery(query, SPEC);
    const where: Prisma.WorkspaceWhereInput = {
      AND: [scope, parsed.where as Prisma.WorkspaceWhereInput],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.WorkspaceOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.workspace.count({ where }),
    ]);
    const members = await this.memberIds(items.map((w) => w.id));
    return paginate(
      items.map((w) => workspaceResponse(w, members.get(w.id) ?? [])),
      total,
      parsed.page,
      parsed.pageSize,
    );
  }

  private async findScoped(user: User, id: string) {
    const scope = await this.access.scopeWhere(user, 'id');
    const ws = await this.prisma.workspace.findFirst({ where: { AND: [scope, { id }] } });
    if (!ws) throw new NotFoundException('Not found.');
    return ws;
  }

  async retrieve(user: User, id: string) {
    const ws = await this.findScoped(user, id);
    const members = await this.memberIds([ws.id]);
    return workspaceResponse(ws, members.get(ws.id) ?? []);
  }

  /** Workspace creation is a platform-admin action — every client surface says
   *  so (onboarding, the workspace guard, the switcher), and the creator is
   *  stamped as owner and ACTIVE MANAGER, so leaving it open let any account
   *  mint itself a tenant it fully controls. Enforced here, not in the UI. */
  async create(user: User, dto: CreateWorkspaceDto) {
    if (!this.access.isPlatformAdmin(user)) {
      throw new ForbiddenException('Only administrators can create workspaces');
    }
    if (dto.manager) return this.createFor(user, dto);
    const workspaceId = generateId();
    const [ws] = await this.prisma.$transaction([
      this.prisma.workspace.create({
        data: {
          id: workspaceId,
          name: dto.name,
          description: dto.description ?? '',
          ownerId: user.id,
          settings: this.newSettings(dto.settings),
        },
      }),
      this.prisma.workspaceMember.create({
        data: {
          id: generateId(),
          workspaceId,
          userId: user.id,
          role: 'MANAGER',
          status: 'ACTIVE',
        },
      }),
    ]);
    // Post-commit side effect: membership event.
    this.emitMemberAdded({ workspaceId, userId: user.id, role: 'MANAGER', via: 'created', actorId: user.id });
    return workspaceResponse(ws, [user.id]);
  }

  /**
   * A workspace created FOR somebody: they own it and are its first Manager.
   *
   * The administrator who made a workspace used to become its owner and a
   * Manager in it for good — on the roster, counted absent every day, asked to
   * decide every leave and join request, and counted as "another approver", so
   * the real manager could not decide their own leave. Owners cannot be demoted,
   * removed or made to leave, so nothing could be done about it. An
   * administrator needs no membership to administer it.
   */
  private async createFor(user: User, dto: CreateWorkspaceDto) {
    const manager = dto.manager!;
    const workspaceId = generateId();
    await this.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: dto.name,
        description: dto.description ?? '',
        // Held by the administrator only until the manager is in, a statement later.
        ownerId: user.id,
        settings: this.newSettings(dto.settings),
      },
    });
    const undo = () => this.prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
    let added: Awaited<ReturnType<UsersService['invite']>>;
    try {
      // The same door as adding anybody: an account made if there is none, the
      // membership, the notice, the welcome mail — and the temporary password
      // handed back when mail cannot carry it.
      added = await this.users.invite(user, {
        workspaceId,
        name: manager.name,
        email: manager.email,
        roleName: 'MANAGER',
      });
    } catch (err) {
      await undo();
      throw err;
    }
    if ('softError' in added) {
      await undo();
      throw new BadRequestException(added.softError.message);
    }
    const body = added.body as { userId: string; emailSent?: boolean; temporaryPassword?: string };
    const owned = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { ownerId: body.userId },
    });
    return {
      ...workspaceResponse(owned, [body.userId]),
      manager: {
        userId: body.userId,
        name: manager.name,
        email: manager.email.toLowerCase(),
        emailSent: body.emailSent ?? false,
        ...(body.temporaryPassword ? { temporaryPassword: body.temporaryPassword } : {}),
      },
    };
  }

  /**
   * Hand the workspace to another of its managers.
   *
   * The owner cannot be demoted, removed, or leave — so without this, whoever
   * created a workspace held it for good, and a workspace whose owner moved on
   * could never be re-homed. The new owner has to be an ACTIVE member whose role
   * could run it (one holding workspace:delete, as the owner's own does).
   */
  async transferOwnership(user: User, id: string, userId: string) {
    const ws = await this.findScoped(user, id);
    if (ws.ownerId !== user.id && !this.access.isPlatformAdmin(user)) {
      throw new ForbiddenException('Only the owner of this workspace can hand it to somebody else.');
    }
    const membership = await this.access.activeMembership(userId, ws.id);
    if (!membership) {
      throw new BadRequestException('The new owner has to be an active member of this workspace.');
    }
    if (!(await this.access.permissionsOfRole(ws.id, membership.role)).has(Permission.WorkspaceDelete)) {
      throw new BadRequestException(
        'The new owner needs a role that can run the workspace — make them a Manager first.',
      );
    }
    const updated =
      ws.ownerId === userId
        ? ws
        : await this.prisma.workspace.update({ where: { id: ws.id }, data: { ownerId: userId } });
    if (updated !== ws) {
      tellPeople(this.events, {
        workspaceId: ws.id,
        recipients: [userId],
        actorId: user.id,
        type: 'WORKSPACE_OWNERSHIP_TRANSFERRED',
        title: 'You now own a workspace',
        message: `${user.name || user.email} handed ${ws.name} to you. As its owner you can delete it or hand it on.`,
        relatedEntityId: ws.id,
        relatedEntityType: 'workspace',
      });
    }
    const members = await this.memberIds([updated.id]);
    return workspaceResponse(updated, members.get(updated.id) ?? []);
  }

  async update(user: User, id: string, dto: UpdateWorkspaceDto) {
    const ws = await this.findScoped(user, id);
    await this.access.assertPermission(user, ws.id, Permission.WorkspaceUpdate);
    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    const { row: updated, reconciled } =
      dto.settings === undefined
        ? { row: await this.prisma.workspace.update({ where: { id: ws.id }, data }), reconciled: null }
        : await this.saveSettings(ws.id, this.checkedSettings(dto.settings), data);
    if (reconciled) this.afterWorkingWeekChange(user, updated.id, reconciled);
    const members = await this.memberIds([updated.id]);
    return {
      ...workspaceResponse(updated, members.get(updated.id) ?? []),
      ...(reconciled ? { reconciled: this.summary(reconciled) } : {}),
    };
  }

  /**
   * Store a workspace's settings, and re-count what a change of working week
   * re-prices — one transaction, under the calendar lock.
   *
   * The working week is a history (see WorkspaceSettings.workingWeek), folded
   * into the row as it stands UNDER the lock: folded into a copy read before it,
   * two saves at once each kept the history as it was, the second erased the
   * first's change, and what the first had re-counted no longer matched any rule.
   * A change of working week is a change of calendar, held and re-counted as a
   * holiday is — see calendar-lock.ts: leave across a Saturday that starts or
   * stops being worked costs a day more or less from today on.
   */
  private saveSettings(
    workspaceId: string,
    input: WorkspaceSettingsInput,
    data: Prisma.WorkspaceUpdateInput,
  ) {
    // From the workspace's own today, in the zone it is declaring now. Days
    // before keep the rule they were worked under.
    const today = todayIn(businessTimezone(input.timezone ?? null));
    const fromDay = businessDayMarker(input.timezone ?? null);
    return this.prisma.$transaction(async (tx) => {
      await lockCalendar(tx, workspaceId);
      const current = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const settings: WorkspaceSettings = settingsToStore(input, current.settings, today);
      const row = await tx.workspace.update({
        where: { id: workspaceId },
        data: { ...data, settings: settings as Prisma.InputJsonValue },
      });
      const before = workingWeekOf(current.settings);
      const after = workingWeekOf(settings);
      const reconciled = sameWorkingWeekFrom(today, before, after)
        ? null
        : await reconcileWorkingWeekChange(tx, workspaceId, fromDay, before, after);
      return { row, reconciled };
    }, CALENDAR_TRANSACTION);
  }

  /** What a working-week change re-counted, as the API reports it. */
  private summary({ unannounced: _rows, ...counts }: CalendarReconciliation) {
    return counts;
  }

  /**
   * Once a working-week change has committed: the rows the write hook could not
   * see are announced, and the people whose approved leave it re-counted — their
   * balance moved — are told, as a holiday change tells them.
   */
  private afterWorkingWeekChange(
    user: User,
    workspaceId: string,
    reconciled: CalendarReconciliation,
  ): void {
    for (const written of reconciled.unannounced ?? []) {
      this.prisma.announceWrite?.(written.model, written.action, written.row);
    }
    if (!reconciled.peopleCharged?.length) return;
    tellPeople(this.events, {
      workspaceId,
      recipients: reconciled.peopleCharged,
      actorId: user.id,
      type: 'LEAVE_BALANCE_ADJUSTED',
      title: 'Leave re-counted for a change of working week',
      message:
        'The Saturdays this workspace works have changed from today, so approved leave across them was counted again. Open Leave to see your balance.',
      relatedEntityType: 'LEAVE',
    });
  }

  /**
   * A settings object from a request, checked and reduced to what a workspace
   * can actually declare.
   *
   * A value no reader would recognise — a timezone the runtime does not know, a
   * start time that is not a time — would be skipped in silence and leave the
   * office on the default while its settings page showed something else, so it
   * is refused here rather than stored and forgotten. Keys outside the contract
   * are dropped: the column used to keep whatever it was sent.
   */
  private checkedSettings(input: unknown): WorkspaceSettingsInput {
    const parsed = parseWorkspaceSettings(input);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    return parsed.settings;
  }

  /** Settings for a workspace that does not exist yet: nothing to fold into, and
   *  its working week — when it declares one — holds from its first day. */
  private newSettings(input: unknown): Prisma.InputJsonValue {
    const checked = this.checkedSettings(input);
    const today = todayIn(businessTimezone(checked.timezone ?? null));
    return settingsToStore(checked, {}, today) as Prisma.InputJsonValue;
  }

  async remove(user: User, id: string): Promise<void> {
    const ws = await this.findScoped(user, id);
    await this.access.assertPermission(user, ws.id, Permission.WorkspaceDelete);
    await this.prisma.workspace.delete({ where: { id: ws.id } });
  }

  emitMemberAdded(payload: WorkspaceMemberAddedPayload): void {
    this.events.emit(WorkspaceEvents.MemberAdded, {
      name: WorkspaceEvents.MemberAdded,
      workspaceId: payload.workspaceId,
      payload,
      occurredAt: new Date().toISOString(),
    });
  }
}
