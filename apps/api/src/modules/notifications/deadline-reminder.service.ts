import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { todayIn, workScheduleOf } from '@strata/config';
import { PrismaService } from '@strata/prisma';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import type { User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { MailService } from '../mail/mail.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';

/**
 * Deadline + overdue reminders, computed SERVER-SIDE.
 *
 * This used to run in every member's browser (a task scan deduped only by that
 * browser's `localStorage`), so N members opening the dashboard produced N
 * duplicate notifications for every assignee — and each of them had to be able
 * to list the whole workspace's tasks to do it. Both problems are structural and
 * only fixable here.
 *
 * Idempotence is a property of the DATA, not of the caller: before writing, the
 * scan reads back the reminders already created today for the same
 * (recipient, type, task) and skips them. So it stays correct no matter how many
 * clients trigger it, how many API instances run it, or how a scheduler retries.
 * `scannedOn` is only a cheap in-process short-circuit on top of that.
 *
 * Every "day" here is a BUSINESS day: a calendar date in the workspace's own
 * timezone (`settings.timezone`, else the host's — see businessTimezone). A
 * task's due day is the date its `dueDate` falls on there, which is the day the
 * screens show, since a due date is stored as its day's midnight in the zone it
 * was picked in. "One reminder per task per recipient per business day" is the
 * contract.
 *
 * It used to be UTC days measured against exact instants: days remaining was
 * `ceil((due - now) / 24h)`, while the dedupe, the Redis claim and the mail's
 * job id were keyed by UTC date. "13 Nov" picked in IST is 12 Nov 18:30 UTC, so
 * each 24-hour window in which the arithmetic said "7 days" straddled two UTC
 * dates — and the 7-, 3- and 1-day reminders and the first overdue notice all
 * went out twice, in-app and by mail, for anybody not on UTC. The date in the
 * message was printed in UTC too: "due on Nov 12" for a task due on the 13th.
 */

/** Days before the due date that earn a reminder. 0 is the due day itself,
 *  which used to earn nothing: the last word before "overdue" came a day early. */
export const DEADLINE_REMINDER_DAYS = [0, 1, 3, 7] as const;
/** Stop nagging about tasks that went overdue more than this long ago. */
const MAX_OVERDUE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const REMINDER_TYPE = 'TASK_DEADLINE_REMINDER';
const OVERDUE_TYPE = 'TASK_OVERDUE';

/** Matches the frontend template's `toLocaleDateString('en-US', …)` output, in
 *  the business zone: the same task renders the same date on every host, and it
 *  is the date the task is due on. */
const dueDateFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });

/** A `YYYY-MM-DD` calendar date as a whole number of days. Exact: a date has no
 *  zone and no DST hour, so the difference of two of these is whole days. */
const dayNumber = (isoDay: string): number => Date.parse(`${isoDay}T00:00:00Z`) / DAY_MS;

interface Candidate {
  userId: string;
  taskId: string;
  projectId: string;
  type: string;
  title: string;
  message: string;
}

/** `assigneeIds` is a JSON column, so anything could be in it. */
function readUserIds(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

@Injectable()
export class DeadlineReminderService {
  private readonly logger = new Logger('DeadlineReminder');
  /** workspaceId → business day already scanned by THIS process. */
  private readonly scannedOn = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly mail: MailService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /**
   * POST notifications/deadline_scan — the workspace's daily scan, now: the
   * scheduler runs it every hour, and nothing in the app calls this; it is for
   * running it by hand. Any member may ask; the first request of the business
   * day does the work and the rest are a no-op. Membership is the only requirement because the caller never sees
   * the tasks: the scan reads them server-side and addresses each reminder to
   * the task's own assignees.
   */
  async runForWorkspace(
    user: User,
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<{ scanned: boolean; created: number }> {
    await this.access.assertMember(user, workspaceId);

    let dayKey: string | undefined;
    try {
      const zone = await this.zoneOf(workspaceId);
      dayKey = todayIn(zone, now);
      if (this.scannedOn.get(workspaceId) === dayKey) return { scanned: false, created: 0 };
      // Claim the day BEFORE awaiting: set afterwards, every request that arrives
      // during the scan passes the guard and scans again.
      this.scannedOn.set(workspaceId, dayKey);

      const created = await this.scanIn(workspaceId, zone, now);
      return { scanned: true, created };
    } catch (err) {
      // Release the claim so the next caller retries rather than losing the day.
      if (dayKey !== undefined && this.scannedOn.get(workspaceId) === dayKey) {
        this.scannedOn.delete(workspaceId);
      }
      this.logger.warn(`deadline scan failed (${workspaceId}): ${(err as Error).message}`);
      return { scanned: false, created: 0 };
    }
  }

  /** The scan itself. Safe to call repeatedly — see the class comment. */
  async scan(workspaceId: string, now: Date = new Date()): Promise<number> {
    return this.scanIn(workspaceId, await this.zoneOf(workspaceId), now);
  }

  /** The zone the workspace keeps its days in: the same one attendance and the
   *  team page's overdue count read (workScheduleOf → businessTimezone). */
  private async zoneOf(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    return workScheduleOf(workspace?.settings).timeZone;
  }

  private async scanIn(workspaceId: string, zone: string, now: Date): Promise<number> {
    const today = todayIn(zone, now);
    // The query window is in instants and the decision below is in business
    // days, so it is a day wider than the marks on each side: a due date is its
    // day's midnight in whatever zone it was picked in (UTC-12 to UTC+14), and a
    // business day can be 25 hours long.
    const horizon = new Date(now.getTime() + (Math.max(...DEADLINE_REMINDER_DAYS) + 2) * DAY_MS);
    const oldest = new Date(now.getTime() - (MAX_OVERDUE_DAYS + 2) * DAY_MS);

    // One query for both windows: the per-task day arithmetic below decides
    // which side of today a row falls on. The old client did two round trips and
    // then an N+1 `GET /projects/:id` per task for a project name that neither
    // notification template actually renders.
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId,
        status: { not: 'DONE' },
        dueDate: { gte: oldest, lte: horizon },
      },
      select: { id: true, title: true, projectId: true, dueDate: true, assigneeIds: true },
    });

    // A task goes on listing people after they leave the workspace; reminders
    // about its deadline are not theirs any more.
    const current = new Set(
      tasks.length === 0
        ? []
        : (
            await this.prisma.workspaceMember.findMany({
              where: { workspaceId, status: 'ACTIVE' },
              select: { userId: true },
            })
          ).map((m) => m.userId),
    );

    const format = dueDateFormat(zone);
    const candidates: Candidate[] = [];
    for (const task of tasks) {
      if (!task.dueDate) continue;
      // Whole business days, date to date: constant for the whole of today, so
      // every hourly scan of the day agrees with the dedupe key below.
      const daysRemaining = dayNumber(todayIn(zone, task.dueDate)) - dayNumber(today);

      let type: string;
      let title: string;
      let message: string;
      if ((DEADLINE_REMINDER_DAYS as readonly number[]).includes(daysRemaining)) {
        type = REMINDER_TYPE;
        title = `Deadline Reminder: ${task.title}`;
        message =
          daysRemaining === 0
            ? `Reminder: "${task.title}" is due today (${format.format(task.dueDate)}).`
            : `Reminder: "${task.title}" is due on ${format.format(task.dueDate)}. ${daysRemaining} day(s) remaining.`;
      } else if (daysRemaining < 0 && -daysRemaining <= MAX_OVERDUE_DAYS) {
        const daysOverdue = -daysRemaining;
        type = OVERDUE_TYPE;
        title = `Task Overdue: ${task.title}`;
        message = `"${task.title}" is overdue by ${daysOverdue} day(s)`;
      } else {
        continue;
      }

      const recipients = new Set(
        readUserIds(task.assigneeIds).filter((id) => current.has(id)),
      );
      for (const userId of recipients) {
        candidates.push({ userId, taskId: task.id, projectId: task.projectId, type, title, message });
      }
    }

    if (candidates.length === 0) return 0;

    const sent = await this.alreadySentToday(workspaceId, candidates, zone, today, now);
    const emails = await this.recipientEmails(candidates);

    let created = 0;
    for (const c of candidates) {
      const key = `${c.userId}|${c.type}|${c.taskId}`;
      if (sent.has(key)) continue;
      sent.add(key);
      // "Already sent today" is read before anything is written, so two scans at
      // once — the hourly tick on two instances, or a tick and a dashboard's
      // trigger — both read "not yet" and both wrote. Claim it first.
      if (!(await this.claim(`${key}|${today}`))) continue;

      await this.notifications.deliver({
        workspaceId,
        userId: c.userId,
        type: c.type,
        title: c.title,
        message: c.message,
        projectId: c.projectId,
        relatedEntityId: c.taskId,
        relatedEntityType: 'TASK',
      });
      created += 1;

      await this.emailReminder(workspaceId, c, emails.get(c.userId), today);
    }

    if (created > 0) this.logger.log(`deadline scan ${workspaceId}: ${created} reminder(s)`);
    return created;
  }

  private async claim(key: string): Promise<boolean> {
    if (!this.redis) return true;
    try {
      return (await this.redis.set(`deadline-reminder:${key}`, '1', 'EX', 2 * 24 * 3600, 'NX')) === 'OK';
    } catch {
      return true; // the read-back dedupe below still stands
    }
  }

  /** The durable dedupe: reminders already written this business day, in one query. */
  private async alreadySentToday(
    workspaceId: string,
    candidates: Candidate[],
    zone: string,
    today: string,
    now: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.notification.findMany({
      where: {
        workspaceId,
        type: { in: [REMINDER_TYPE, OVERDUE_TYPE] },
        relatedEntityId: { in: [...new Set(candidates.map((c) => c.taskId))] },
        // Today began at most 25 hours ago wherever the office is. Read a little
        // more and cut at the business day below, rather than work out the
        // instant of the zone's midnight.
        createdAt: { gte: new Date(now.getTime() - 2 * DAY_MS) },
      },
      select: { userId: true, type: true, relatedEntityId: true, createdAt: true },
    });
    return new Set(
      rows
        .filter((r) => todayIn(zone, r.createdAt) === today)
        .map((r) => `${r.userId}|${r.type}|${r.relatedEntityId}`),
    );
  }

  private async recipientEmails(candidates: Candidate[]): Promise<Map<string, { email: string; name: string }>> {
    const rows = await this.prisma.user.findMany({
      // Active accounts only: a task goes on listing somebody after their
      // account is switched off, and its title is not theirs to be mailed.
      where: { id: { in: [...new Set(candidates.map((c) => c.userId))] }, isActive: true },
      select: { id: true, email: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, { email: r.email, name: r.name }]));
  }

  /** Both templates are `requiresEmail` on the frontend, so the move to the
   *  server must keep the mail. Best effort: a mail failure never loses the
   *  in-app notification that was already written. */
  private async emailReminder(
    workspaceId: string,
    c: Candidate,
    recipient: { email: string; name: string } | undefined,
    dayKey: string,
  ): Promise<void> {
    if (!recipient?.email) return;
    try {
      if (!(await this.preferences.allows(workspaceId, c.userId, c.type, 'email'))) return;
      await this.mail.sendTaskDeadlineReminder({
        to: recipient.email,
        name: recipient.name,
        title: c.title,
        message: c.message,
        // One mail per recipient/task/type/business day, matching the in-app
        // dedupe: a retried scan re-enqueues the same BullMQ jobId and is ignored.
        idempotencyKey: `deadline:${c.userId}:${c.type}:${c.taskId}:${dayKey}`,
      });
    } catch (err) {
      this.logger.warn(`deadline reminder mail failed (${c.taskId}): ${(err as Error).message}`);
    }
  }
}
