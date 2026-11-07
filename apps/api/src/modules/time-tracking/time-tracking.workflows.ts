import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId, toRequiredDate } from '@strata/common';
import { HrEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { ActiveTimer, Prisma, TimeEntry, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { StartTimerDto, StopTimerDto } from './dto';
import { activeTimerResponse, discardedTimerResponse, timeEntryResponse } from './mappers';
import { assertProjectWritable } from '../projects/project-archive';
import {
  FUTURE_SKEW_MS,
  MAX_ENTRY_MINUTES,
  MIN_ENTRY_MINUTES,
  announceTimeAwaiting,
  mayLogTime,
  minutesInWords,
  namesOfWork,
} from './time-tracking.services';

/** What became of the timer a new one replaced — see TimerService.settle. */
interface ReplacedTimer {
  logged: boolean;
  /** The entry it became, when it became one. */
  timeEntryId?: string;
  /** Said to the person, who asked for one timer and got a decision about another. */
  message: string;
}

/** Server-side timer lifecycle + duration computation. */
@Injectable()
export class TimerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private timer(userId: string): Promise<ActiveTimer | null> {
    return this.prisma.activeTimer.findUnique({ where: { userId } });
  }

  /**
   * Start a timer — on a task, a project, or nothing in particular.
   *
   * What it is for is read from the records, not taken from the request: the
   * task's own title, code, project and workspace. A timer used to store
   * whatever ids and title it was sent, so time could be logged against a task
   * the person cannot see, under a title they made up, and filed in front of
   * approvers of another workspace.
   *
   * One timer per person. Starting another while one runs is refused — unless
   * `replace` says to switch: the running one is stopped and its time logged
   * first. The browser used to "switch" by DELETING whatever timer was running,
   * so a second tab or device silently threw away hours that were never filed.
   */
  async start(user: User, dto: StartTimerDto) {
    const running = await this.timer(user.id);
    if (running && !dto.replace) {
      throw new ConflictException({
        message: `A timer is already running${running.taskTitle ? ` on "${running.taskTitle}"` : ''}. Stop it, or switch it to this task.`,
        type: 'TimerRunning',
      });
    }
    const target = await this.target(user, dto);
    const replaced = running
      ? await this.settle(user, running, target.workspaceId || dto.workspaceId || '')
      : undefined;
    const t = await this.prisma.activeTimer.create({
      data: {
        id: generateId(),
        userId: user.id,
        startTime: new Date(),
        workspaceId: target.workspaceId,
        taskId: target.taskId,
        taskTitle: target.taskTitle,
        taskHierarchyId: target.taskHierarchyId,
        projectId: target.projectId,
        description: dto.description ?? '',
      },
    });
    return { ...activeTimerResponse(t), ...(replaced ? { replaced } : {}) };
  }

  /**
   * The timer being replaced: logged if it can be, otherwise thrown away.
   *
   * Filing asks for the right to log time in the timer's own workspace. Once
   * its owner had left that workspace, or lost the right there, the switch was
   * refused with a 403 — and so was Stop, and a plain start was refused because
   * a timer was running. Nothing could ever end it. Time that cannot be filed
   * anywhere is discarded here instead, and the answer says so: nobody is left
   * believing it was logged.
   *
   * A run too long for one entry is NOT discarded: that time can still be
   * logged once its owner says when they stopped, so the switch is refused
   * (see file) rather than throwing a day's work away.
   */
  private async settle(user: User, t: ActiveTimer, fallback: string): Promise<ReplacedTimer> {
    const workspaceId = t.workspaceId || fallback;
    if (workspaceId && !(await mayLogTime(this.access, user, workspaceId))) {
      await this.prisma.activeTimer.delete({ where: { id: t.id } });
      return {
        logged: false,
        message:
          'The timer that was running was discarded, not logged: you can no longer log time in the workspace it was started in.',
      };
    }
    const result = await this.file(user, t, fallback);
    if ('discarded' in result) return { logged: false, message: result.message };
    return {
      logged: true,
      timeEntryId: result.id,
      message: 'The time on the previous timer was logged.',
    };
  }

  /** What the timer is for, from the task or project itself. */
  private async target(
    user: User,
    dto: StartTimerDto,
  ): Promise<{
    workspaceId: string;
    projectId: string;
    taskId: string;
    taskTitle: string;
    taskHierarchyId: string;
  }> {
    if (dto.taskId) {
      const task = await this.prisma.task.findUnique({
        where: { id: dto.taskId },
        select: { id: true, title: true, hierarchyId: true, projectId: true, workspaceId: true },
      });
      if (!task) throw new NotFoundException('That task no longer exists.');
      await this.access.assertPermission(user, task.workspaceId, Permission.HrWrite);
      if (dto.projectId && dto.projectId !== task.projectId) {
        throw new BadRequestException('That task is not in that project.');
      }
      // No new time against an archived project's work (see project-archive).
      await assertProjectWritable(this.prisma, task.projectId);
      return {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: task.title,
        taskHierarchyId: task.hierarchyId,
      };
    }
    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
        select: { id: true, workspaceId: true },
      });
      if (!project) throw new NotFoundException('That project no longer exists.');
      await this.access.assertPermission(user, project.workspaceId, Permission.HrWrite);
      await assertProjectWritable(this.prisma, project.id);
      return { workspaceId: project.workspaceId, projectId: project.id, taskId: '', taskTitle: '', taskHierarchyId: '' };
    }
    if (dto.workspaceId) await this.access.assertPermission(user, dto.workspaceId, Permission.HrWrite);
    return { workspaceId: dto.workspaceId ?? '', projectId: '', taskId: '', taskTitle: '', taskHierarchyId: '' };
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

  /**
   * Running the clock again is starting it again, so a timer whose project was
   * archived while it was paused cannot be resumed. It can still be stopped —
   * the time it already holds was worked before the archive — or discarded:
   * neither is held up by the project, or the timer could never end.
   */
  async resume(user: User) {
    const t = await this.timer(user.id);
    if (!t) throw new NotFoundException('No active timer');
    if (!t.isPaused) return activeTimerResponse(t);
    await assertProjectWritable(this.prisma, t.projectId);
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
    return this.file(user, t, dto.workspaceId, dto);
  }

  /**
   * The end its owner gives a timer they left running: after it started, and
   * not later than now (allowing a client clock a little ahead of ours).
   */
  private statedEnd(t: ActiveTimer, value: string, now: Date): Date {
    const end = toRequiredDate(value, 'End time');
    if (end.getTime() <= t.startTime.getTime()) {
      throw new BadRequestException('The end has to come after the timer started.');
    }
    if (end.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      throw new BadRequestException('A timer cannot be stopped at a time that has not come yet.');
    }
    return end.getTime() > now.getTime() ? now : end;
  }

  /**
   * Turn a running timer into a time entry, in the workspace it was started
   * for. Only a timer from before timers recorded one is filed in `fallback`,
   * the workspace the caller is in.
   */
  private async file(
    user: User,
    t: ActiveTimer,
    fallback: string,
    dto: Partial<StopTimerDto> = {},
  ) {
    const workspaceId = t.workspaceId || fallback;
    if (!workspaceId) throw new BadRequestException('Which workspace is this time for?');
    if (!(await mayLogTime(this.access, user, workspaceId))) {
      // Said with the way out: the bare "no permission" left the owner pressing
      // Stop on a timer that could never stop. Discarding needs no permission.
      throw new ForbiddenException({
        message:
          'You can no longer log time in the workspace this timer was started in, so it cannot be filed. Discard it instead.',
        type: 'TimerNotLoggable',
      });
    }
    const now = new Date();
    const end = dto.endTime ? this.statedEnd(t, dto.endTime, now) : now;
    // Paused time is kept as a running total plus the pause under way, so only
    // the latter can be placed against a stated end: a pause still running when
    // the work ended counts up to that end, completed pauses count in full.
    let pausedSecs = t.totalPausedTime;
    if (t.isPaused && t.pausedAt) {
      pausedSecs += Math.max(0, Math.round((end.getTime() - t.pausedAt.getTime()) / 1000));
    }
    const durationMin = Math.max(
      0,
      Math.round((end.getTime() - t.startTime.getTime()) / 60000 - pausedSecs / 60),
    );

    if (durationMin > MAX_ENTRY_MINUTES) {
      // The rule a typed-in entry has always had. A timer left running over a
      // weekend filed a 64-hour entry for an approver to wave through, and the
      // edit dialog could not even show it. Nothing is written and the timer
      // keeps running, so its owner can say when they actually stopped.
      throw new BadRequestException({
        message: dto.endTime
          ? `That still makes ${minutesInWords(durationMin)} — one entry covers at most 24 hours. Pick an earlier end, and log the rest by hand.`
          : `This timer has been running for ${minutesInWords(durationMin)} — more than one entry can cover (24 hours), so nothing was logged. Say when you stopped working to log it, or discard it.`,
        type: 'TimerTooLong',
      });
    }

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
    // The timer's own task title was read from the task when it started; the
    // project's name is read now, as a manual entry's is.
    const { projectName } = await namesOfWork(this.prisma, null, t.projectId);
    const [entry] = await this.prisma.$transaction([
      this.prisma.timeEntry.create({
        data: {
          id: entryId,
          workspaceId,
          userId: user.id,
          userName: user.name || user.email,
          userEmail: user.email,
          createdById: user.id,
          createdByName: user.name ?? '',
          taskId: t.taskId,
          taskTitle: t.taskTitle,
          taskHierarchyId: t.taskHierarchyId,
          projectId: t.projectId,
          projectName,
          description: t.description,
          startTime: t.startTime,
          endTime: end,
          duration: durationMin,
          isBillable: dto.isBillable ?? false,
          status: 'PENDING',
        },
      }),
      this.prisma.activeTimer.delete({ where: { id: t.id } }),
    ]);
    await announceTimeAwaiting(this.access, this.events, user, workspaceId);
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

  private emit(event: string, entry: TimeEntry, approver: User, reason?: string): void {
    this.events.emit(event, {
      name: event,
      workspaceId: entry.workspaceId,
      payload: {
        workspaceId: entry.workspaceId,
        userId: entry.userId,
        timeEntryId: entry.id,
        approverId: approver.id,
        ...(reason ? { reason } : {}),
      },
      occurredAt: new Date().toISOString(),
    });
  }

  /**
   * Nobody approves their own hours — unless nobody else can. The rule leave
   * already followed: in a workspace with one approver, that person's own time
   * sat "awaiting approval" for good, and the screen pointed at an approver
   * who did not exist.
   */
  private async assertMayDecideOwn(user: User, entry: TimeEntry): Promise<void> {
    if (entry.userId !== user.id) return;
    const others = (await this.access.membersHolding(entry.workspaceId, Permission.TimeApprove)).filter(
      (holder) => holder !== user.id,
    );
    if (others.length > 0) {
      throw new ForbiddenException(
        'You cannot approve your own time entry. Somebody else who approves time here has to.',
      );
    }
  }

  /**
   * Record a decision — conditionally on the entry still being pending AND
   * still saying what it said when it was loaded.
   *
   * load() read it on an earlier statement. Claiming on the status alone kept
   * two approvers from both deciding, but not the owner from editing in between:
   * the edit landed, the claim still matched PENDING, and the approval went on
   * record against hours and a billable flag the approver had never seen. The
   * window, the duration and the billable flag are what a decision vouches for,
   * so the claim is on them too; the owner's edit is conditional on the status
   * from its side (TimeEntriesService.patch).
   */
  private async claim(
    entry: TimeEntry,
    data: Prisma.TimeEntryUpdateManyMutationInput,
  ): Promise<TimeEntry> {
    const claimed = await this.prisma.timeEntry.updateMany({
      where: {
        id: entry.id,
        status: 'PENDING',
        startTime: entry.startTime,
        endTime: entry.endTime,
        duration: entry.duration,
        isBillable: entry.isBillable,
      },
      data,
    });
    if (claimed.count === 0) {
      const now = await this.prisma.timeEntry.findUnique({
        where: { id: entry.id },
        select: { status: true },
      });
      if (now?.status === 'PENDING') {
        throw new ConflictException({
          message:
            'This entry was changed while you were deciding. Refresh to see what it says now, then decide again.',
          type: 'ChangedWhileDeciding',
        });
      }
      throw new BadRequestException('Time entry already handled');
    }
    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    // A conditional `updateMany` — see PrismaService.announceWrite.
    this.prisma.announceWrite?.('TimeEntry', 'update', updated);
    return updated;
  }

  async approve(user: User, id: string) {
    const entry = await this.load(user, id);
    await this.assertMayDecideOwn(user, entry);
    // Conditional on it still being pending: load() read the status on an
    // earlier statement, so two approvers clicking at once would both write a
    // decision and both emit TimeEntryApproved. The loser is told it was already
    // handled instead of overwriting the decision that is already recorded.
    const updated = await this.claim(entry, {
      status: 'APPROVED',
      approvedBy: user.id,
      approvedAt: new Date(),
    });
    this.emit(HrEvents.TimeEntryApproved, updated, user);
    return timeEntryResponse(updated);
  }

  async reject(user: User, id: string, reason?: string) {
    const entry = await this.load(user, id);
    // Your own entry is yours to edit or delete; "rejecting" it sent you a
    // notice about yourself and left a rejected entry nobody had judged.
    if (entry.userId === user.id) {
      throw new ForbiddenException('Edit or delete your own entry instead of rejecting it.');
    }
    const updated = await this.claim(entry, {
      status: 'REJECTED',
      approvedBy: user.id,
      approvedAt: new Date(),
      rejectionReason: reason ?? '',
    });
    this.emit(HrEvents.TimeEntryRejected, updated, user, reason);
    return timeEntryResponse(updated);
  }
}
