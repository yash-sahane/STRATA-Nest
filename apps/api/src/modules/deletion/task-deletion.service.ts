import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectDelete, type TxLike } from './deletion.util';

/**
 * TaskDeletionService — Task aggregate (→ TaskComment). Sub-tasks reference
 * `parentTaskId` as a plain string column, not a foreign key, so deleting a
 * parent task leaves it dangling on the sub-task rather than cascading.
 */
@Injectable()
export class TaskDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async delete(user: User, taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, task.workspaceId, Permission.TaskWrite);
    const workspaceId = task.workspaceId;
    const deleted: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      await collectDelete(tx, 'taskComment', 'task_comments', { taskId }, deleted, workspaceId);
      await tx.task.deleteMany({ where: { id: taskId } }); // deleteMany → single explicit frame
      deleted.push({ collection: 'tasks', id: taskId, workspaceId });
    });

    this.sideEffects.emitDeletes(deleted);
  }
}
