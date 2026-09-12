import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import { writeAuditRow } from '../activity/audit-writer';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectUpdate, type TxLike } from './deletion.util';

/**
 * EpicDeletionService — Epic delete with UNLINK semantics: linked tasks and
 * functional requirements are kept and detached (`epicId` -> ''), then the
 * epic row is removed. All in one transaction so an interruption never leaves
 * a half-detached tree.
 */
@Injectable()
export class EpicDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async delete(user: User, epicId: string): Promise<void> {
    const epic = await this.prisma.epic.findUnique({ where: { id: epicId } });
    if (!epic) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, epic.workspaceId, Permission.PlanningWrite);
    const workspaceId = epic.workspaceId;
    const deleted: DeletedEntity[] = [];
    const detached: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      // collectUpdate for the tasks so open boards learn the epic link went
      // away; the FR detach stays a plain updateMany — no client subscribes to
      // functional_requirements.
      await collectUpdate(tx, 'task', 'tasks', { epicId }, { epicId: '' }, detached, workspaceId);
      await txc.functionalRequirement.updateMany({ where: { epicId }, data: { epicId: '' } });
      await tx.epic.deleteMany({ where: { id: epicId } }); // deleteMany → single explicit frame
      deleted.push({ collection: 'epics', id: epicId, workspaceId });
    });

    this.sideEffects.emitUpdates(detached);
    this.sideEffects.emitDeletes(deleted);
    // Aggregate deletes never touch ScopedCrudService.remove, so the trail is
    // appended here. Only the ROOT is recorded — a cascade can remove hundreds of
    // rows and one audit entry per child would bury the action that caused them.
    await writeAuditRow(this.prisma, {
      workspaceId: workspaceId,
      userId: user.id,
      entity: 'epic',
      action: 'deleted',
      entityId: epicId,
      row: epic as unknown as Record<string, unknown>,
      extraMetadata: { cascadeRows: deleted.length },
    });
  }
}
