import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { assertDateRangeOrdered, type ListQuerySpec, toDate } from '@strata/common';
import { RequirementEvents } from '@strata/shared';
import { PrismaService, refreshClientRequirementRollup } from '@strata/prisma';
import type { Epic, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { createWithFreeHierarchyId } from '../generation/hierarchy-id.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { emitDomainEvent } from '../workspaces/domain-event';
import { assertLinkInProject, assertProjectInWorkspace } from '../workspaces/workspace-refs';
import type { CreateEpicDto, UpdateEpicDto } from './dto';
import { epicResponse } from './mappers';
import { mintEpicHierarchyId } from '../generation/hierarchy-ids';
import { assertProjectWritable } from '../projects/project-archive';

@Injectable()
export class EpicsService extends ScopedCrudService<Epic, ReturnType<typeof epicResponse>> {
  protected readonly model = 'epic';
  /** Carries a `version` column, so a stale save is refused rather than applied. */
  protected override readonly versioned = true;
  protected readonly auditEntity = 'epic';
  protected readonly writePermission: PermissionKey = Permission.PlanningWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      status: { field: 'status' },
      requirementId: { field: 'requirementId' },
      hierarchyId: { field: 'hierarchyId' },
    },
    sortable: { createdAt: 'createdAt', hierarchyId: 'hierarchyId', name: 'name' },
    search: ['name', 'hierarchyId', 'description'],
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: Epic) {
    return epicResponse(row);
  }
  async create(user: User, dto: CreateEpicDto) {
    // A cross-workspace epic was listed under the other workspace's project
    // while being scoped to this one, and left that workspace permanently
    // undeletable — its cascade hit a row it had no right to touch.
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    await assertProjectWritable(this.prisma, dto.projectId);
    await assertLinkInProject(
      this.prisma, 'clientRequirement', 'Client requirement', dto.requirementId, dto.projectId,
    );
    const startDate = toDate(dto.startDate, 'Start date');
    const endDate = toDate(dto.endDate, 'End date');
    assertDateRangeOrdered(startDate, endDate, { start: 'Start date', end: 'Target end date' });
    const fields = {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      requirementId: dto.requirementId ?? '',
      name: dto.name,
      description: dto.description ?? '',
      color: dto.color ?? '',
      startDate,
      endDate,
      // Its roll-up, as an epic with no work under it stands (rollups.ts).
      status: 'TODO',
      progress: 0,
      createdById: user.id,
      createdByName: user.name ?? '',
    };
    // The server mints the id, one past the highest in use (a caller may still
    // name its own). Two creates at once can mint the same one; the second takes
    // the next free id rather than being refused — see createWithFreeHierarchyId.
    const created = await createWithFreeHierarchyId(
      dto.hierarchyId || (await mintEpicHierarchyId(this.prisma, dto.projectId)),
      async (hierarchyId) =>
        (await this.prisma.epic.findFirst({
          where: { projectId: dto.projectId, hierarchyId },
          select: { id: true },
        })) !== null,
      (hierarchyId) => this.createIn(user, dto.workspaceId, { ...fields, hierarchyId }),
    );
    emitDomainEvent(this.events, RequirementEvents.EpicCreated, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      entityId: created.id,
      title: dto.name,
      actorId: user.id,
      actorName: user.name || user.email,
    });
    return created;
  }
  async patch(user: User, id: string, dto: UpdateEpicDto) {
    const data: Record<string, unknown> = {};
    if (dto.hierarchyId !== undefined) data.hierarchyId = dto.hierarchyId;
    if (dto.name !== undefined) data.name = dto.name;
    // The epic as it stands. Every patch reads it: an epic of an archived
    // project takes no changes at all (see project-archive).
    const row = await this.findScoped(user, id);
    await assertProjectWritable(this.prisma, row.projectId);
    // Set only for a patch that moves the epic to another client requirement.
    let stored: Epic | null = null;
    if (dto.requirementId !== undefined) {
      stored = row;
      // The check create makes: an epic serves a client requirement of its own
      // project, not one from anywhere.
      if (dto.requirementId) {
        await assertLinkInProject(
          this.prisma, 'clientRequirement', 'Client requirement', dto.requirementId, stored.projectId,
        );
      }
      data.requirementId = dto.requirementId;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.startDate !== undefined) data.startDate = toDate(dto.startDate, 'Start date');
    if (dto.endDate !== undefined) data.endDate = toDate(dto.endDate, 'End date');
    // Validate against the pair the row will END UP with, so moving one end
    // alone cannot produce a range the create path would have refused.
    //
    // "Cleared" (null) is not "untouched" (absent): `?? row.startDate` put a
    // start date the caller had just removed back into the check, so clearing
    // the start while pulling the end in was refused over a date that was going.
    if (data.startDate !== undefined || data.endDate !== undefined) {
      assertDateRangeOrdered(
        data.startDate !== undefined ? (data.startDate as Date | null) : row.startDate,
        data.endDate !== undefined ? (data.endDate as Date | null) : row.endDate,
        { start: 'Start date', end: 'Target end date' },
      );
    }
    const saved = await this.update(user, id, data, dto.basedOn);
    if (stored && (dto.requirementId || '') !== (stored.requirementId || '')) {
      await this.moveRequirementsWith(stored, dto.requirementId || '');
    }
    return saved;
  }

  /**
   * The epic now serves another client requirement (or none): so does the work
   * raised under it.
   *
   * A functional requirement belongs to the client requirement its epic does —
   * that is how the requirement forms file it. Moving the epic left them behind:
   * the new client requirement said "Nothing raised yet", the old one went on
   * counting them, and a cascade delete of the old one deleted work that was no
   * longer its.
   *
   * One transaction for the move and the two statuses it changes, so nobody
   * reads the requirements under the new client requirement while its status
   * still describes the old set. `updateMany` is invisible to the realtime
   * hook, so the moved rows are announced once they are committed.
   */
  private async moveRequirementsWith(epic: Epic, requirementId: string): Promise<void> {
    // The epic's own project only: a stray cross-project link must never widen
    // what this move touches.
    const where = {
      epicId: epic.id,
      projectId: epic.projectId,
      clientRequirementId: { not: requirementId },
    };
    const moved = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.functionalRequirement.findMany({
        where,
        select: { id: true, clientRequirementId: true },
      });
      if (rows.length > 0) {
        await tx.functionalRequirement.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { clientRequirementId: requirementId, version: { increment: 1 } },
        });
      }
      // Each client requirement they left, the one the epic left, and the one
      // they joined.
      const touched = new Set(
        [epic.requirementId, requirementId, ...rows.map((row) => row.clientRequirementId)].filter(
          Boolean,
        ),
      );
      for (const clientRequirementId of touched) {
        await refreshClientRequirementRollup(tx, clientRequirementId);
      }
      return rows.map((row) => row.id);
    });
    if (moved.length === 0) return;
    const rows = await this.prisma.functionalRequirement.findMany({ where: { id: { in: moved } } });
    for (const row of rows) this.prisma.announceWrite?.('FunctionalRequirement', 'update', row);
  }
}
