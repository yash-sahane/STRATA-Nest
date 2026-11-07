import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PlanningEvents, type SprintLifecyclePayload } from '@strata/shared';
import { PrismaService } from '@strata/prisma';

/** What a human may have set on a requirement with no tasks to say it is done. */
const FINISHED_WITHOUT_TASKS: ReadonlySet<string> = new Set(['TESTED', 'DEPLOYED']);

/**
 * When a sprint completes, roll its incomplete (status != DONE) tasks off the
 * sprint (back to the backlog) — and the functional requirements those tasks
 * belong to with them. This is the Tasks-side reaction to `sprint.completed`,
 * which SprintCompletionService emits after commit.
 */
@Injectable()
export class SprintCompletedTaskRoller {
  private readonly logger = new Logger('SprintCompletedTaskRoller');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Starting a sprint puts its planned work on the board: Backlog -> To Do.
   *
   * The browser used to do this itself — list the sprint's Backlog tasks, then
   * PATCH them one by one — so a sprint started from anywhere else, or by a tab
   * that closed part-way, was ACTIVE with its tasks still parked in Backlog.
   */
  @OnEvent(PlanningEvents.SprintStarted)
  async onSprintStarted(event: { payload: SprintLifecyclePayload }): Promise<void> {
    const moving = await this.idsOf({ sprintId: event.payload.sprintId, status: 'BACKLOG' });
    const res = await this.prisma.task.updateMany({
      where: { id: { in: moving } },
      data: { status: 'TODO', version: { increment: 1 } },
    });
    await this.announce(moving);
    if (res.count > 0) {
      this.logger.log(
        `Moved ${res.count} task(s) to To Do on the start of sprint ${event.payload.sprintId}`,
      );
    }
  }

  @OnEvent(PlanningEvents.SprintCompleted)
  async onSprintCompleted(event: { payload: SprintLifecyclePayload }): Promise<void> {
    const count = await this.rollIncomplete(event.payload.sprintId);
    const requirements = await this.rollUnfinishedRequirements(event.payload.sprintId);
    if (count > 0 || requirements > 0) {
      this.logger.log(
        `Rolled ${count} incomplete task(s) and ${requirements} unfinished requirement(s) off completed sprint ${event.payload.sprintId}`,
      );
    }
  }

  /** Detach incomplete tasks from the sprint (sprintId → ""). Returns the count. */
  async rollIncomplete(sprintId: string): Promise<number> {
    const moving = await this.idsOf({ sprintId, status: { not: 'DONE' } });
    const res = await this.prisma.task.updateMany({
      where: { id: { in: moving } },
      data: { sprintId: '', version: { increment: 1 } },
    });
    await this.announce(moving);
    return res.count;
  }

  private async idsOf(where: Record<string, unknown>): Promise<string[]> {
    const rows = await this.prisma.task.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }

  /**
   * `updateMany` is invisible to the realtime write hook, so a colleague's open
   * board kept showing these tasks where they had been until it was reloaded.
   */
  private async announce(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.prisma.task.findMany({ where: { id: { in: [...ids] } } });
    for (const row of rows) this.prisma.announceWrite?.('Task', 'update', row);
  }

  /**
   * Detach the requirements that are not finished either. Returns the count.
   *
   * Sprints are PLANNED by requirement: the backlog screen assigns a functional
   * requirement to a sprint and its tasks follow. Rolling only the tasks left
   * every unfinished requirement pinned to the sprint that had just closed — so
   * it never came back to the "FR Backlog" to be planned again, and (because My
   * Tasks hides work whose requirement sits in a non-active sprint) its open
   * tasks vanished from the screen of the people they were assigned to.
   *
   * Unfinished means it still has a task that is not DONE. A requirement with no
   * tasks at all goes by its own status, the only thing that can say so.
   */
  async rollUnfinishedRequirements(sprintId: string): Promise<number> {
    const requirements = await this.prisma.functionalRequirement.findMany({
      where: { sprintId },
      select: { id: true, status: true },
    });
    if (requirements.length === 0) return 0;

    const tasks = await this.prisma.task.findMany({
      where: { functionalRequirementId: { in: requirements.map((r) => r.id) } },
      select: { functionalRequirementId: true, status: true },
    });
    const hasTasks = new Set(tasks.map((t) => t.functionalRequirementId));
    const hasOpenTask = new Set(
      tasks.filter((t) => t.status !== 'DONE').map((t) => t.functionalRequirementId),
    );
    const unfinished = requirements
      .filter((r) =>
        hasTasks.has(r.id) ? hasOpenTask.has(r.id) : !FINISHED_WITHOUT_TASKS.has(r.status),
      )
      .map((r) => r.id);
    if (unfinished.length === 0) return 0;

    const res = await this.prisma.functionalRequirement.updateMany({
      where: { id: { in: unfinished } },
      data: { sprintId: '' },
    });
    // The rolled-out requirements are back in "Not in a Sprint" — say so to the
    // planning and requirement pages open on them (updateMany is invisible to
    // the write hook).
    for (const row of await this.prisma.functionalRequirement.findMany({
      where: { id: { in: unfinished } },
    })) {
      this.prisma.announceWrite?.('FunctionalRequirement', 'update', row);
    }
    return res.count;
  }
}
