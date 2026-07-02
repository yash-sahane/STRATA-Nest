import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@lt/common';
import { HrEvents } from '@lt/shared';
import { PrismaService } from '@lt/prisma';
import type { ActiveTimer, Prisma, TimeEntry, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { StartTimerDto, StopTimerDto } from './dto';
import { activeTimerResponse, timeEntryResponse } from './mappers';

/** [NEW] server-side timer lifecycle + duration computation (D9). */
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

  /** Stop → compute duration (minutes, minus paused time) → create TimeEntry, delete timer. */
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
          billableRate: dto.billableRate ?? null,
          type: t.type,
          status: 'PENDING',
        },
      }),
      this.prisma.activeTimer.delete({ where: { id: t.id } }),
    ]);
    return timeEntryResponse(entry as TimeEntry);
  }
}

/** [NEW] time-entry approval (manager-only, self-approval blocked). */
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
      throw new ForbiddenException('Cannot approve your own time entry'); // D9
    }
    const updated = await this.prisma.timeEntry.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date() },
    });
    this.emit(HrEvents.TimeEntryApproved, updated);
    return timeEntryResponse(updated);
  }

  async reject(user: User, id: string, reason?: string) {
    const entry = await this.load(user, id);
    const updated = await this.prisma.timeEntry.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedBy: user.id,
        approvedAt: new Date(),
        rejectionReason: reason ?? '',
      },
    });
    this.emit(HrEvents.TimeEntryRejected, updated);
    return timeEntryResponse(updated);
  }
}
