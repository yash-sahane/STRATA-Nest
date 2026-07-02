import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@lt/common';
import { PlanningEvents } from '@lt/shared';
import { PrismaService } from '@lt/prisma';
import type { Prisma, Sprint, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { sprintResponse } from './mappers';

/**
 * Application service (arch §3.1) — [NEW] server-side sprint completion:
 * close the sprint + seed an empty retrospective (if none) in one transaction,
 * then emit SprintCompleted after commit.
 *
 * Rolling incomplete tasks to the backlog/next sprint is wired in Phase 6 (a
 * Tasks subscriber to `sprint.completed`) — the Task model does not exist yet.
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
