import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectDelete, type TxLike } from './deletion.util';

/**
 * SprintDeletionService — Sprint aggregate (→ Retrospective). Tasks reference
 * `sprintId` as a plain string column, not a foreign key, so deleting a sprint
 * leaves the `sprintId` dangling on the task rather than cascading; nulling it
 * out is a possible alternative that is not currently done.
 */
@Injectable()
export class SprintDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async delete(user: User, sprintId: string): Promise<void> {
    const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, sprint.workspaceId, Permission.PlanningWrite);
    const workspaceId = sprint.workspaceId;
    const deleted: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      await collectDelete(tx, 'retrospective', 'retrospectives', { sprintId }, deleted, workspaceId);
      await tx.sprint.deleteMany({ where: { id: sprintId } }); // deleteMany → single explicit frame
      deleted.push({ collection: 'sprints', id: sprintId, workspaceId });
    });

    this.sideEffects.emitDeletes(deleted);
  }
}
