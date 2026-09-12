import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { HrEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { ActiveTimer, Prisma, TimeEntry, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { StartTimerDto, StopTimerDto } from './dto';
import { activeTimerResponse, discardedTimerResponse, timeEntryResponse } from './mappers';
import { MIN_ENTRY_MINUTES, resolveBillableRate } from './time-tracking.services';

/** Server-side timer lifecycle + duration computation. */
@Injectable()
export class TimerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  private timer(userId: string): Promise<ActiveTimer | null> {
    return this.prisma.activeTimer.findUnique({ where: { userId } });
  }

  async start(user: User, dto: StartTimerDto) {
    if (await this.timer(user.id)) throw new BadRequestException('A timer is already running');
    const t = await this.prisma.activeTimer.create({
      data: {
        id: generateId(),
        userId: user.id,
        startTime: new Date(),
        taskId: dto.taskId ?? '',
        taskTitle: dto.taskTitle ?? '',
        taskHierarchyId: dto.taskHierarchyId ?? '',
        projectId: dto.projectId ?? '',
        description: dto.description ?? '',
        type: dto.type ?? 'TIMER',
        pomodoroSettings: (dto.pomodoroSettings ?? null) as Prisma.InputJsonValue,
      },
    });
    return activeTimerResponse(t);
  }

  async pause(user: User) {
    const t = await this.timer(user.id);
    if (!t) throw new NotFoundException('No active timer');
    if (t.isPaused) return activeTimerResponse(t);
    return activeTimerResponse(
      await this.prisma.activeTimer.update({
        where: { id: t.id },
        data: { isPaused: true, pausedAt: new Date() },
      }),
    );
  }

  async resume(user: User) {
    const t = await this.timer(user.id);
    if (!t) throw new NotFoundException('No active timer');
    if (!t.isPaused) return activeTimerResponse(t);
    const pausedSecs = t.pausedAt ? Math.round((Date.now() - t.pausedAt.getTime()) / 1000) : 0;
    return activeTimerResponse(
      await this.prisma.activeTimer.update({
        where: { id: t.id },
        data: { isPaused: false, pausedAt: null, totalPausedTime: { increment: pausedSecs } },
      }),
    );
  }

  /**
   * Stop → compute duration (minutes, minus paused time) → create TimeEntry,
   * delete timer. A run too short to round to a minute writes NO entry.
   */
  async stop(user: User, dto: StopTimerDto) {
    const t = await this.timer(user.id);
    if (!t) throw new NotFoundException('No active timer');
    await this.access.assertPermission(user, dto.workspaceId, Permission.HrWrite);
    const now = new Date();
    let pausedSecs = t.totalPausedTime;
    if (t.isPaused && t.pausedAt) pausedSecs += Math.round((now.getTime() - t.pausedAt.getTime()) / 1000);
    const durationMin = Math.max(
      0,
      Math.round((now.getTime() - t.startTime.getTime()) / 60000 - pausedSecs / 60),
    );

    if (durationMin < MIN_ENTRY_MINUTES) {
      // Started and stopped again straight away: no work was recorded, so there
      // is nothing to log and — the part that hurt — nothing for anyone else to
      // decide. Two such runs sat in Pending Approvals reading "0m", asking a
      // manager to sign off on no time at all. The timer is dropped and the
      // caller is told nothing was written, rather than rounding a few seconds
      // up into time the member never spent.
      await this.prisma.activeTimer.delete({ where: { id: t.id } });
      return discardedTimerResponse(MIN_ENTRY_MINUTES);
    }

    const entryId = generateId();
    const [entry] = await this.prisma.$transaction([
      this.prisma.timeEntry.create({
        data: {
          id: entryId,
          workspaceId: dto.workspaceId,
          userId: user.id,
          userName: user.name || user.email,
          userEmail: user.email,
          createdById: user.id,
          createdByName: user.name ?? '',
          taskId: t.taskId,
          taskTitle: t.taskTitle,
          taskHierarchyId: t.taskHierarchyId,
          projectId: t.projectId,
          description: t.description,
          startTime: t.startTime,
          endTime: now,
          duration: durationMin,
          isBillable: dto.isBillable ?? false,
          // Same rule as a manual entry: a rate is only kept on a billable one.
          billableRate: resolveBillableRate(dto.isBillable ?? false, dto.billableRate),
          type: t.type,
          status: 'PENDING',
        },
      }),
      this.prisma.activeTimer.delete({ where: { id: t.id } }),
    ]);
    return timeEntryResponse(entry as TimeEntry);
  }
}

/** Time-entry approval (manager-only, self-approval blocked). */
@Injectable()
export class TimeApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  private async load(user: User, id: string): Promise<TimeEntry> {
    const entry = await this.prisma.timeEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, entry.workspaceId, Permission.TimeApprove);
    if (entry.status !== 'PENDING') throw new BadRequestException('Time entry already handled');
    return entry;
  }

  private emit(event: string, entry: TimeEntry): void {
    this.events.emit(event, {
      name: event,
      workspaceId: entry.workspaceId,
      payload: { workspaceId: entry.workspaceId, userId: entry.userId, timeEntryId: entry.id },
      occurredAt: new Date().toISOString(),
    });
  }

  async approve(user: User, id: string) {
    const entry = await this.load(user, id);
    if (entry.userId === user.id) {
      throw new ForbiddenException('Cannot approve your own time entry'); // self-approval block
    }
    // Conditional on it still being pending: load() read the status on an
    // earlier statement, so two approvers clicking at once would both write a
    // decision and both emit TimeEntryApproved. The loser is told it was already
    // handled instead of overwriting the decision that is already recorded.
    const claimed = await this.prisma.timeEntry.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Time entry already handled');
    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id } });
    this.emit(HrEvents.TimeEntryApproved, updated);
    return timeEntryResponse(updated);
  }

  async reject(user: User, id: string, reason?: string) {
    // Not bound: load() is called for its guards (existence, TimeApprove, still
    // PENDING), and reject needs none of the row's fields.
    await this.load(user, id);
    const claimed = await this.prisma.timeEntry.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        approvedBy: user.id,
        approvedAt: new Date(),
        rejectionReason: reason ?? '',
      },
    });
    if (claimed.count === 0) throw new BadRequestException('Time entry already handled');
    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id } });
    this.emit(HrEvents.TimeEntryRejected, updated);
    return timeEntryResponse(updated);
  }
}
