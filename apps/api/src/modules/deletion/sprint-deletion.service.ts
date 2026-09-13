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
 * SprintDeletionService — Sprint aggregate (→ Retrospective). Tasks and
 * functional requirements are NOT deleted: both carry a soft `sprintId` FK and
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
    const workspaceId = sprint.workspaceId;
    const deleted: DeletedEntity[] = [];
    const detached: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      // Move tasks back to the backlog. collectUpdate so every OPEN board learns
      // the columns changed — a bare updateMany emits nothing.
      await collectUpdate(tx, 'task', 'tasks', { sprintId }, { sprintId: '' }, detached, workspaceId);
      // Plain updateMany for the FRs: there is no functional_requirements
      // realtime channel for the frames to feed.
      await txc.functionalRequirement.updateMany({ where: { sprintId }, data: { sprintId: '' } });
      await collectDelete(tx, 'retrospective', 'retrospectives', { sprintId }, deleted, workspaceId);
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
