import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import { writeAuditRow } from '../activity/audit-writer';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectDelete, collectUpdate, type TxLike } from './deletion.util';
import { assertDeletable } from './assert-deletable';

/**
 * TaskDeletionService — Task aggregate (→ TaskComment). Sub-tasks are NOT
 * deleted: they are detached (`parentTaskId` -> '') in the same transaction
 * and become normal tasks. Time entries are kept as-is — they carry
 * denormalized task title/hierarchy for display, so work logs are never lost.
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
    // assertDeletable, not assertPermission: the pair (403 exists / 404 does
    // not) answered "does this id exist?" for somebody with no membership at
    // all. A stranger now gets 404; a member without the right still gets 403.
    await assertDeletable(this.access, user, task.workspaceId, Permission.TaskWrite);
    const workspaceId = task.workspaceId;
    const deleted: DeletedEntity[] = [];
    const detached: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      // Detach sub-tasks (they become normal tasks) and tell every open board.
      await collectUpdate(
        tx, 'task', 'tasks', { parentTaskId: taskId }, { parentTaskId: '' }, detached, workspaceId,
      );
      await collectDelete(tx, 'taskComment', 'task_comments', { taskId }, deleted, workspaceId);
      await tx.task.deleteMany({ where: { id: taskId } }); // deleteMany → single explicit frame
      deleted.push({ collection: 'tasks', id: taskId, workspaceId });
    });

    this.sideEffects.emitUpdates(detached);
    this.sideEffects.emitDeletes(deleted);
    // Aggregate deletes never touch ScopedCrudService.remove, so the trail is
    // appended here. Only the ROOT is recorded — a cascade can remove hundreds of
    // rows and one audit entry per child would bury the action that caused them.
    await writeAuditRow(this.prisma, {
      workspaceId: workspaceId,
      userId: user.id,
      entity: 'task',
      action: 'deleted',
      entityId: taskId,
      row: task as unknown as Record<string, unknown>,
      extraMetadata: { cascadeRows: deleted.length },
    });
  }
}
