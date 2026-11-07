import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PlanningEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { sprintResponse } from './mappers';
import { assertProjectWritable } from '../projects/project-archive';

/**
 * Server-side sprint completion: close the sprint and record what it got
 * through, then emit SprintCompleted after commit.
 *
 * It used to seed a row in a separate `retrospectives` table as well — three
 * lists (went well, needs improvement, action items) that no screen ever read
 * or wrote. A sprint's retrospective is `Sprint.retrospectiveNotes`, written
 * and shown on the sprint's analytics page.
 *
 * Rolling incomplete tasks back to the backlog is handled separately by a
 * Tasks-side subscriber to `sprint.completed`.
 */
@Injectable()
export class SprintCompletionService {
  private readonly logger = new Logger('SprintCompletion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  async complete(user: User, sprintId: string) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, sprint.workspaceId, Permission.PlanningWrite);
    // Completing rolls unfinished work out of the sprint: a change to the
    // project, which an archived one does not take (see project-archive).
    await assertProjectWritable(this.prisma, sprint.projectId);
    if (sprint.status === 'COMPLETED') throw new BadRequestException('Sprint already completed');
    // Completing records what the sprint got through. One that never started
    // got through nothing: it is edited or deleted, not completed.
    if (sprint.status !== 'ACTIVE') {
      throw new BadRequestException('Only a sprint that has been started can be completed.');
    }

    // Count the sprint as it stands, BEFORE the roll-out. `sprint.completed` is
    // emitted after this transaction commits and its subscriber clears sprintId
    // on everything unfinished, so these figures are the only surviving record
    // of what the sprint actually got through. Without them the analytics page —
    // which filters tasks by sprintId — sees the DONE ones alone and reports
    // 100% for every completed sprint.
    const [totalTaskCount, completedTaskCount, team] = await Promise.all([
      this.prisma.task.count({ where: { sprintId } }),
      this.prisma.task.count({ where: { sprintId, status: 'DONE' } }),
      // Who to tell, read for the same reason as the counts: once the unfinished
      // tasks are rolled out, nothing says they were ever in this sprint.
      this.prisma.task.findMany({ where: { sprintId }, select: { assigneeIds: true } }),
    ]);
    const assigneeIds = [
      ...new Set(
        team.flatMap((t) => (Array.isArray(t.assigneeIds) ? (t.assigneeIds as string[]) : [])),
      ),
    ];

    // Conditional on the sprint still being ACTIVE: two clicks, or two people,
    // both read ACTIVE above, and an unconditional write let both complete it —
    // the roll-out ran twice and everybody on the sprint was told twice.
    const { count } = await this.prisma.sprint.updateMany({
      where: { id: sprintId, status: 'ACTIVE' },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalTaskCount,
        completedTaskCount,
        rolledOverTaskCount: totalTaskCount - completedTaskCount,
        version: { increment: 1 },
      },
    });
    if (count === 0) {
      throw new ConflictException(
        'Somebody else completed or changed this sprint a moment ago. Reload to see where it stands.',
      );
    }
    const updated = await this.prisma.sprint.findUniqueOrThrow({ where: { id: sprintId } });
    // `updateMany` is invisible to the realtime write hook — see
    // PrismaService.announceWrite.
    this.prisma.announceWrite('Sprint', 'update', updated);

    // AWAITED: the roll-out of unfinished work is a subscriber to this event,
    // and the caller refetches tasks and requirements as soon as this returns.
    // The sprint is already closed, so a subscriber that fails is logged rather
    // than reported as a failed completion.
    try {
      await this.events.emitAsync(PlanningEvents.SprintCompleted, {
        name: PlanningEvents.SprintCompleted,
        workspaceId: sprint.workspaceId,
        payload: {
          workspaceId: sprint.workspaceId,
          projectId: sprint.projectId,
          sprintId,
          actorId: user.id,
          assigneeIds,
        },
        occurredAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(`sprint.completed subscriber failed: ${(err as Error).message}`);
    }
    return sprintResponse(updated);
  }
}
