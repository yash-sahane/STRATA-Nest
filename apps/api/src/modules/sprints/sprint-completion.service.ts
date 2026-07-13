import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { PlanningEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, Sprint, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { sprintResponse } from './mappers';

/**
 * Server-side sprint completion: close the sprint + seed an empty retrospective
 * (if none) in one transaction, then emit SprintCompleted after commit.
 *
 * Rolling incomplete tasks back to the backlog is handled separately by a
 * Tasks-side subscriber to `sprint.completed`.
 */
@Injectable()
export class SprintCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  async complete(user: User, sprintId: string) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, sprint.workspaceId, Permission.PlanningWrite);
    if (sprint.status === 'COMPLETED') throw new BadRequestException('Sprint already completed');

    const existingRetro = await this.prisma.retrospective.findFirst({ where: { sprintId } });
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.sprint.update({ where: { id: sprintId }, data: { status: 'COMPLETED' } }),
    ];
    if (!existingRetro) {
      ops.push(
        this.prisma.retrospective.create({
          data: {
            id: generateId(),
            sprintId,
            workspaceId: sprint.workspaceId,
            projectId: sprint.projectId,
            wentWell: [],
            needsImprovement: [],
            actionItems: [],
            createdById: user.id,
          },
        }),
      );
    }
    const [updated] = await this.prisma.$transaction(ops);

    this.events.emit(PlanningEvents.SprintCompleted, {
      name: PlanningEvents.SprintCompleted,
      workspaceId: sprint.workspaceId,
      payload: { workspaceId: sprint.workspaceId, projectId: sprint.projectId, sprintId },
      occurredAt: new Date().toISOString(),
    });
    return sprintResponse(updated as Sprint);
  }
}
