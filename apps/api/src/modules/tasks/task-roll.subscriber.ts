import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PlanningEvents, type SprintLifecyclePayload } from '@lt/shared';
import { PrismaService } from '@lt/prisma';

/**
 * Phase 5→6 loop: when a sprint completes, roll its incomplete (status != DONE)
 * tasks off the sprint (back to the backlog). This is the Tasks-side reaction to
 * `sprint.completed` — SprintCompletionService emits it after commit (arch §4/§11).
 */
@Injectable()
export class SprintCompletedTaskRoller {
  private readonly logger = new Logger('SprintCompletedTaskRoller');

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(PlanningEvents.SprintCompleted)
  async onSprintCompleted(event: { payload: SprintLifecyclePayload }): Promise<void> {
    const count = await this.rollIncomplete(event.payload.sprintId);
    if (count > 0) {
      this.logger.log(
        `Rolled ${count} incomplete task(s) off completed sprint ${event.payload.sprintId}`,
      );
    }
  }

  /** Detach incomplete tasks from the sprint (sprintId → ""). Returns the count. */
  async rollIncomplete(sprintId: string): Promise<number> {
    const res = await this.prisma.task.updateMany({
      where: { sprintId, status: { not: 'DONE' } },
      data: { sprintId: '' },
    });
    return res.count;
  }
}
