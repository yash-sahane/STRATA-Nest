import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
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
 * Day boundaries are UTC so the result does not depend on the server's locale;
 * "one reminder per task per recipient per UTC day" is the contract.
 */

/** Days before the due date that earn a reminder. */
export const DEADLINE_REMINDER_DAYS = [1, 3, 7] as const;
/** Stop nagging about tasks that went overdue more than this long ago. */
const MAX_OVERDUE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const REMINDER_TYPE = 'TASK_DEADLINE_REMINDER';
const OVERDUE_TYPE = 'TASK_OVERDUE';

/** Matches the frontend template's `toLocaleDateString('en-US', …)` output, but
 *  pinned to UTC so the same task renders the same date on every host. */
const DUE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const utcDayKey = (d: Date): string => d.toISOString().slice(0, 10);
const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

interface Candidate {
  userId: string;
  taskId: string;
  projectId: string;
  type: string;
  title: string;
  message: string;
}

/** `assignedTo` / `assigneeIds` are JSON columns, so anything could be in them. */
function readUserIds(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

@Injectable()
export class DeadlineReminderService {
  private readonly logger = new Logger('DeadlineReminder');
  /** workspaceId → UTC day already scanned by THIS process. */
  private readonly scannedOn = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly mail: MailService,
  ) {}

  /**
   * POST notifications/deadline_scan — any member may ask for the workspace's
   * daily scan; the first request of the UTC day does the work and the rest are
   * a no-op. Membership is the only requirement because the caller never sees
   * the tasks: the scan reads them server-side and addresses each reminder to
   * the task's own assignees.
   */
  async runForWorkspace(
    user: User,
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<{ scanned: boolean; created: number }> {
    await this.access.assertMember(user, workspaceId);

    const dayKey = utcDayKey(now);
    if (this.scannedOn.get(workspaceId) === dayKey) return { scanned: false, created: 0 };
    // Claim the day BEFORE awaiting: set afterwards, every request that arrives
    // during the scan passes the guard and scans again.
    this.scannedOn.set(workspaceId, dayKey);

    try {
      const created = await this.scan(workspaceId, now);
      return { scanned: true, created };
    } catch (err) {
      // Release the claim so the next caller retries rather than losing the day.
      this.scannedOn.delete(workspaceId);
      this.logger.warn(`deadline scan failed (${workspaceId}): ${(err as Error).message}`);
      return { scanned: false, created: 0 };
    }
  }

  /** The scan itself. Safe to call repeatedly — see the class comment. */
  async scan(workspaceId: string, now: Date = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + (Math.max(...DEADLINE_REMINDER_DAYS) + 1) * DAY_MS);
    const oldest = new Date(now.getTime() - (MAX_OVERDUE_DAYS + 1) * DAY_MS);

    // One query for both windows: the per-task day arithmetic below decides
    // which side of `now` a row falls on. The old client did two round trips and
    // then an N+1 `GET /projects/:id` per task for a project name that neither
    // notification template actually renders.
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId,
        status: { not: 'DONE' },
        dueDate: { gte: oldest, lte: horizon },
      },
      select: { id: true, title: true, projectId: true, dueDate: true, assignedTo: true, assigneeIds: true },
    });

    const candidates: Candidate[] = [];
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const daysRemaining = Math.ceil((task.dueDate.getTime() - now.getTime()) / DAY_MS);

      let type: string;
      let title: string;
      let message: string;
      if ((DEADLINE_REMINDER_DAYS as readonly number[]).includes(daysRemaining)) {
        type = REMINDER_TYPE;
        title = `Deadline Reminder: ${task.title}`;
        message = `Reminder: "${task.title}" is due on ${DUE_DATE_FORMAT.format(task.dueDate)}. ${daysRemaining} day(s) remaining.`;
      } else if (daysRemaining < 0 && -daysRemaining <= MAX_OVERDUE_DAYS) {
        const daysOverdue = -daysRemaining;
        type = OVERDUE_TYPE;
        title = `Task Overdue: ${task.title}`;
        message = `"${task.title}" is overdue by ${daysOverdue} day(s)`;
      } else {
        continue;
      }

      const recipients = new Set([...readUserIds(task.assignedTo), ...readUserIds(task.assigneeIds)]);
      for (const userId of recipients) {
        candidates.push({ userId, taskId: task.id, projectId: task.projectId, type, title, message });
      }
    }

    if (candidates.length === 0) return 0;

    const sent = await this.alreadySentToday(workspaceId, candidates, now);
    const emails = await this.recipientEmails(candidates);

    let created = 0;
    for (const c of candidates) {
      const key = `${c.userId}|${c.type}|${c.taskId}`;
      if (sent.has(key)) continue;
      sent.add(key); // a task listed in both assignedTo and assigneeIds appears twice

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

      await this.emailReminder(workspaceId, c, emails.get(c.userId), utcDayKey(now));
    }

    if (created > 0) this.logger.log(`deadline scan ${workspaceId}: ${created} reminder(s)`);
    return created;
  }

  /** The durable dedupe: reminders already written today, in one query. */
  private async alreadySentToday(
    workspaceId: string,
    candidates: Candidate[],
    now: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.notification.findMany({
      where: {
        workspaceId,
        type: { in: [REMINDER_TYPE, OVERDUE_TYPE] },
        relatedEntityId: { in: [...new Set(candidates.map((c) => c.taskId))] },
        createdAt: { gte: startOfUtcDay(now) },
      },
      select: { userId: true, type: true, relatedEntityId: true },
    });
    return new Set(rows.map((r) => `${r.userId}|${r.type}|${r.relatedEntityId}`));
  }

  private async recipientEmails(candidates: Candidate[]): Promise<Map<string, { email: string; name: string }>> {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(candidates.map((c) => c.userId))] } },
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
        // One mail per recipient/task/type/day, matching the in-app dedupe: a
        // retried scan re-enqueues the same BullMQ jobId and is ignored.
        idempotencyKey: `deadline:${c.userId}:${c.type}:${c.taskId}:${dayKey}`,
      });
    } catch (err) {
      this.logger.warn(`deadline reminder mail failed (${c.taskId}): ${(err as Error).message}`);
    }
  }
}
