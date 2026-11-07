import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import { DeadlineReminderService } from './deadline-reminder.service';

/** Long enough after boot that migrations, seeding and the first requests are done. */
const FIRST_RUN_MS = 2 * 60 * 1000;
/** Hourly: the scan sends each reminder at most once per business day whatever
 *  the cadence, so this only decides how soon after the workspace's midnight the
 *  day's go out — and how soon a restart catches up. */
const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs the deadline scan on a clock instead of on somebody's page load.
 *
 * The scan itself has been server-side for a while, but the only thing that
 * ever started it was a member opening the app. A workspace nobody opened on a
 * given day got no reminders that day — and since a reminder is sent on exact
 * marks (7, 3, 1 days out, the due day), a mark that fell on a quiet day was
 * skipped for good: a task could go from "a week away" to overdue without one.
 *
 * No lock is needed between API instances: `DeadlineReminderService.scan` is
 * idempotent by data (it reads back what was already sent today), which is the
 * property its own comment promises a scheduler. The client-triggered route is
 * left in place; it has simply stopped being the only trigger.
 */
@Injectable()
export class DeadlineReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DeadlineReminderScheduler');
  private first?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deadlines: DeadlineReminderService,
  ) {}

  onModuleInit(): void {
    // Unit and e2e suites boot the whole module graph; none of them wants a
    // background scan writing notifications into whatever database they use.
    if (process.env.NODE_ENV === 'test') return;
    this.first = setTimeout(() => void this.tick(), FIRST_RUN_MS);
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    // A pending scan must never be what keeps the process alive at shutdown.
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over every workspace. Returns how many reminders it created. */
  async tick(now: Date = new Date()): Promise<number> {
    // A slow pass must not be overlapped by the next one.
    if (this.running) return 0;
    this.running = true;
    let created = 0;
    try {
      const workspaces = await this.prisma.workspace.findMany({ select: { id: true } });
      for (const { id } of workspaces) {
        try {
          created += await this.deadlines.scan(id, now);
        } catch (err) {
          // One workspace failing must not cost the others their reminders.
          this.logger.warn(`deadline scan failed (${id}): ${(err as Error).message}`);
        }
      }
      if (created > 0) this.logger.log(`created ${created} deadline reminder(s)`);
    } catch (err) {
      this.logger.warn(`deadline pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return created;
  }
}
