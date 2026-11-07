import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import { writeAuditRow } from '../activity/audit-writer';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectUpdate, type TxLike } from './deletion.util';
import { assertDeletable } from './assert-deletable';
import { assertProjectWritable } from '../projects/project-archive';

/**
 * SprintDeletionService — the Sprint itself. Tasks and functional
 * requirements are NOT deleted: both carry a soft `sprintId` FK and
 * are moved out of the sprint (`sprintId` -> '', i.e. back to the backlog) in
 * the same transaction so nothing is left pointing at a nonexistent sprint.
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
    // assertDeletable, not assertPermission: the pair (403 exists / 404 does
    // not) answered "does this id exist?" for somebody with no membership at
    // all. A stranger now gets 404; a member without the right still gets 403.
    await assertDeletable(this.access, user, sprint.workspaceId, Permission.PlanningWrite);
    // An archived project keeps its work as it was (see project-archive).
    // Deleting the PROJECT is still allowed; its cascade does not come here.
    await assertProjectWritable(this.prisma, sprint.projectId);
    // A completed sprint holds the work it finished: deleting it took that work
    // out of every sprint report and velocity figure. Only an empty one goes.
    if (sprint.status === 'COMPLETED') {
      const finished = await this.prisma.task.count({ where: { sprintId } });
      if (finished > 0) {
        throw new ConflictException(
          `This sprint is complete and holds ${finished} finished ${finished === 1 ? 'task' : 'tasks'}: it is part of the project's history, so it cannot be deleted. It can still be renamed.`,
        );
      }
    }
    const workspaceId = sprint.workspaceId;
    const deleted: DeletedEntity[] = [];
    const detached: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      // Move tasks back to the backlog. collectUpdate so every OPEN board learns
      // the columns changed — a bare updateMany emits nothing.
      await collectUpdate(tx, 'task', 'tasks', { sprintId }, { sprintId: '' }, detached, workspaceId);
      // And the requirements planned into it: the planning page and the
      // requirements page show which sprint each is in.
      await collectUpdate(
        tx, 'functionalRequirement', 'functional_requirements', { sprintId }, { sprintId: '' }, detached, workspaceId,
      );
      await tx.sprint.deleteMany({ where: { id: sprintId } }); // deleteMany → single explicit frame
      deleted.push({ collection: 'sprints', id: sprintId, workspaceId });
    });

    this.sideEffects.emitUpdates(detached);
    this.sideEffects.emitDeletes(deleted);
    // Aggregate deletes never touch ScopedCrudService.remove, so the trail is
    // appended here. Only the ROOT is recorded — a cascade can remove hundreds of
    // rows and one audit entry per child would bury the action that caused them.
    await writeAuditRow(this.prisma, {
      workspaceId: workspaceId,
      userId: user.id,
      entity: 'sprint',
      action: 'deleted',
      entityId: sprintId,
      row: sprint as unknown as Record<string, unknown>,
      extraMetadata: { cascadeRows: deleted.length },
    });
  }
}
