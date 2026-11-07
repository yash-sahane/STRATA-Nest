import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService, refreshDeliveryRollups } from '@strata/prisma';
import { writeAuditRow } from '../activity/audit-writer';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectDelete, collectUpdate, type TxLike } from './deletion.util';
import { assertDeletable } from './assert-deletable';
import { tellPeople } from '../notifications/notice';

/** A JSON id column as the ids it holds (the column is `Json`, so it can hold anything). */
const idList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * TaskDeletionService — Task aggregate (→ TaskComment). Sub-tasks are NOT
 * deleted: they are detached (`parentTaskId` -> '') in the same transaction
 * and become normal tasks. Tasks it blocked, or that blocked it, lose the edge
 * in the same transaction. Time entries are kept as-is — they carry
 * denormalized task title/hierarchy for display, so work logs are never lost.
 * Its attachments stay too, as the project's own files.
 */
@Injectable()
export class TaskDeletionService {
  private readonly logger = new Logger('TaskDeletion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly sideEffects: DeletionSideEffectsService,
    @Optional() private readonly events?: EventEmitter2,
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
      // Off every dependency list that names it, both ways round. Left behind,
      // the id was a "blocked by" that the task dialog could not show (there is
      // no task to fetch), the card still counted, and nobody could remove —
      // taking an edge off looked the far end up first, and answered 404.
      // updateMany, one task at a time, for the reason collectUpdate gives:
      // nothing in here may reach the realtime hook before the commit.
      const linked = (await tx.task.findMany({
        where: {
          workspaceId,
          OR: [
            { blockedBy: { array_contains: [taskId] } },
            { blocks: { array_contains: [taskId] } },
          ],
        },
        select: { id: true, blockedBy: true, blocks: true },
      })) as Array<{ id: string; blockedBy?: unknown; blocks?: unknown }>;
      for (const row of linked) {
        const blockedBy = idList(row.blockedBy);
        const blocks = idList(row.blocks);
        if (!blockedBy.includes(taskId) && !blocks.includes(taskId)) continue;
        await tx.task.updateMany({
          where: { id: row.id },
          data: {
            blockedBy: blockedBy.filter((id) => id !== taskId),
            blocks: blocks.filter((id) => id !== taskId),
            version: { increment: 1 },
          },
        });
        detached.push({ collection: 'tasks', id: row.id, workspaceId });
      }
      await collectDelete(tx, 'taskComment', 'task_comments', { taskId }, deleted, workspaceId);
      // Its attachments go back to the project rather than with the task: a
      // screenshot or a log is often the one record of what the task was about.
      await collectUpdate(
        tx, 'uploadedFile', 'files', { taskId, workspaceId }, { taskId: '' }, detached, workspaceId,
      );
      await tx.task.deleteMany({ where: { id: taskId } }); // deleteMany → single explicit frame
      deleted.push({ collection: 'tasks', id: taskId, workspaceId });
    });

    this.sideEffects.emitUpdates(detached);
    this.sideEffects.emitDeletes(deleted);
    // The people who were doing it are told; the task vanished from their board
    // and from "My Tasks" with no word of who took it away, or why it went.
    const assignees = [
      ...new Set(
        (Array.isArray(task.assigneeIds) ? task.assigneeIds : []).filter(
          (id): id is string => typeof id === 'string',
        ),
      ),
    ];
    tellPeople(this.events, {
      workspaceId,
      recipients: assignees,
      actorId: user.id,
      type: 'TASK_DELETED',
      title: `Task deleted: ${task.title}`,
      message: `${user.name || user.email} deleted "${task.title}" (${task.hierarchyId}), which was assigned to you.`,
      projectId: task.projectId,
      relatedEntityType: 'TASK',
    });
    // One task fewer under its requirement and its epic: their status and
    // progress are sums over the tasks, so they are summed again. The browser
    // used to ask for this after its DELETE returned.
    await refreshDeliveryRollups(
      this.prisma,
      { functionalRequirementIds: [task.functionalRequirementId], epicIds: [task.epicId] },
      (error, kind, id) =>
        this.logger.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`),
    );
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
