import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { ClientRequirement, FunctionalRequirement, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
// The hierarchy-id rules live in one tested unit (the generation module owns
// them); requirements imports the pure helpers rather than restating them.
import {
  MAX_HIERARCHY_ID_ATTEMPTS,
  bumpHierarchyId,
  isHierarchyIdConflict,
} from '../generation/hierarchy-id.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { assertProjectInWorkspace } from '../workspaces/workspace-refs';
import type {
  CreateClientRequirementDto,
  CreateFunctionalRequirementDto,
  UpdateClientRequirementDto,
  UpdateFunctionalRequirementDto,
} from './dto';
import { clientRequirementResponse, functionalRequirementResponse } from './mappers';

/** Depth cap for the parent walk — a malformed legacy chain must not spin. */
const MAX_PARENT_DEPTH = 50;

/** The two columns a functional requirement's task rollup owns. */
const FR_ROLLUP_FIELDS: ReadonlySet<string> = new Set(['progress', 'status']);

@Injectable()
export class ClientRequirementsService extends ScopedCrudService<
  ClientRequirement,
  ReturnType<typeof clientRequirementResponse>
> {
  protected readonly model = 'clientRequirement';
  protected readonly auditEntity = 'client_requirement';
  protected readonly writePermission: PermissionKey = Permission.RequirementWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      status: { field: 'status' },
      priority: { field: 'priority' },
      clientName: { field: 'clientName' },
    },
    sortable: { createdAt: 'createdAt', title: 'title' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: ClientRequirement) {
    return clientRequirementResponse(row);
  }
  async create(user: User, dto: CreateClientRequirementDto) {
    await this.access.assertPermission(user, dto.workspaceId, this.writePermission);
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      title: dto.title,
      description: dto.description ?? '',
      clientName: dto.clientName ?? '',
      priority: dto.priority ?? 'MEDIUM',
      status: dto.status ?? 'DRAFT',
      attachments: dto.attachments ?? [],
      createdById: user.id,
      createdByName: user.name ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateClientRequirementDto) {
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.clientName !== undefined) data.clientName = dto.clientName;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.attachments !== undefined) data.attachments = dto.attachments;
    return this.update(user, id, data);
  }
}

@Injectable()
export class FunctionalRequirementsService extends ScopedCrudService<
  FunctionalRequirement,
  ReturnType<typeof functionalRequirementResponse>
> {
  protected readonly model = 'functionalRequirement';
  protected readonly auditEntity = 'functional_requirement';
  protected readonly writePermission: PermissionKey = Permission.RequirementWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      epicId: { field: 'epicId' },
      sprintId: { field: 'sprintId' },
      clientRequirementId: { field: 'clientRequirementId' },
      parentRequirementId: { field: 'parentRequirementId' },
      type: { field: 'type' },
      status: { field: 'status' },
      complexity: { field: 'complexity' },
      hierarchyId: { field: 'hierarchyId' },
      reusable: { field: 'reusable', type: 'boolean' },
    },
    sortable: { createdAt: 'createdAt', hierarchyId: 'hierarchyId' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: FunctionalRequirement) {
    return functionalRequirementResponse(row);
  }

  /**
   * epicId / sprintId / clientRequirementId are soft FKs with no database
   * constraint. Nothing else validates them, so an FR could be linked to a row
   * in another project (or another tenant) and would then show up in that
   * project's filters and cascades. '' clears the link and is always allowed.
   */
  private async assertLinkInProject(
    kind: 'epic' | 'sprint' | 'clientRequirement',
    label: string,
    linkId: string | undefined,
    projectId: string,
  ): Promise<void> {
    if (!linkId) return;
    const where = { id: linkId };
    const select = { projectId: true };
    const row =
      kind === 'epic'
        ? await this.prisma.epic.findUnique({ where, select })
        : kind === 'sprint'
          ? await this.prisma.sprint.findUnique({ where, select })
          : await this.prisma.clientRequirement.findUnique({ where, select });
    if (!row) throw new BadRequestException(`${label} not found.`);
    if (row.projectId !== projectId) {
      throw new BadRequestException(`${label} belongs to a different project.`);
    }
  }

  /**
   * A parent must exist, live in the same project, and never be the row itself
   * or one of its own descendants — a cycle makes the requirement permanently
   * undeletable (collectDescendants finds it as its own child, so the 409 fires
   * forever) and a cascade on either node wipes both.
   */
  private async assertParent(
    parentId: string | undefined,
    projectId: string,
    selfId?: string,
  ): Promise<void> {
    if (!parentId) return;
    if (selfId && parentId === selfId) {
      throw new BadRequestException('A requirement cannot be its own parent.');
    }
    const parent = await this.prisma.functionalRequirement.findUnique({
      where: { id: parentId },
      select: { projectId: true, parentRequirementId: true },
    });
    if (!parent) throw new BadRequestException('Parent requirement not found.');
    if (parent.projectId !== projectId) {
      throw new BadRequestException('Parent requirement belongs to a different project.');
    }
    if (!selfId) return;
    let cursor = parent.parentRequirementId;
    for (let depth = 0; cursor && depth < MAX_PARENT_DEPTH; depth += 1) {
      if (cursor === selfId) {
        throw new BadRequestException('That parent is a descendant of this requirement.');
      }
      const next = await this.prisma.functionalRequirement.findUnique({
        where: { id: cursor },
        select: { parentRequirementId: true },
      });
      cursor = next?.parentRequirementId ?? '';
    }
  }

  /** True when `hierarchyId` is already used by another FR in this project. */
  private async hierarchyIdTaken(projectId: string, hierarchyId: string): Promise<boolean> {
    const row = await this.prisma.functionalRequirement.findFirst({
      where: { projectId, hierarchyId },
      select: { id: true },
    });
    return row !== null;
  }

  async create(user: User, dto: CreateFunctionalRequirementDto) {
    await this.access.assertPermission(user, dto.workspaceId, this.writePermission);
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    await this.assertLinkInProject('epic', 'Epic', dto.epicId, dto.projectId);
    await this.assertLinkInProject('sprint', 'Sprint', dto.sprintId, dto.projectId);
    await this.assertLinkInProject(
      'clientRequirement', 'Client requirement', dto.clientRequirementId, dto.projectId,
    );
    await this.assertParent(dto.parentRequirementId, dto.projectId);
    const data = {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      epicId: dto.epicId ?? '',
      sprintId: dto.sprintId ?? '',
      clientRequirementId: dto.clientRequirementId ?? '',
      parentRequirementId: dto.parentRequirementId ?? '',
      title: dto.title,
      description: dto.description ?? '',
      type: dto.type ?? 'FUNCTIONAL',
      complexity: dto.complexity ?? 'MEDIUM',
      priority: dto.priority ?? '',
      status: dto.status ?? 'DRAFT',
      progress: dto.progress ?? 0,
      reusable: dto.reusable ?? false,
      assignedTo: dto.assignedTo ?? [],
      assignedToNames: dto.assignedToNames ?? [],
      tags: dto.tags ?? '',
      linkedProjectIds: dto.linkedProjectIds ?? '',
      createdById: user.id,
      createdByName: user.name ?? '',
    };

    // hierarchyId arrives from the client as `count + 1`, which repeats as soon
    // as an FR is deleted and races between two concurrent creates. Rejecting
    // the duplicate would only trade a silent collision for a dead-end 400, so
    // allocate the next free id instead: the probe covers the common
    // already-taken case, and the P2002 retry covers a create that lost the race
    // between the probe and the insert (@@unique([projectId, hierarchyId])).
    let hierarchyId = dto.hierarchyId;
    for (let attempt = 0; attempt < MAX_HIERARCHY_ID_ATTEMPTS; attempt += 1) {
      if (await this.hierarchyIdTaken(dto.projectId, hierarchyId)) {
        hierarchyId = bumpHierarchyId(hierarchyId);
        continue;
      }
      try {
        return await this.createIn(user, dto.workspaceId, { ...data, hierarchyId });
      } catch (error) {
        if (!isHierarchyIdConflict(error)) throw error;
        hierarchyId = bumpHierarchyId(hierarchyId);
      }
    }
    throw new ConflictException(
      `Could not allocate a free hierarchy id for this project (tried ${MAX_HIERARCHY_ID_ATTEMPTS} ids from "${dto.hierarchyId}").`,
    );
  }
  async patch(user: User, id: string, dto: UpdateFunctionalRequirementDto) {
    const row = await this.findScoped(user, id);
    await this.assertLinkInProject('epic', 'Epic', dto.epicId, row.projectId);
    await this.assertLinkInProject('sprint', 'Sprint', dto.sprintId, row.projectId);
    await this.assertLinkInProject(
      'clientRequirement', 'Client requirement', dto.clientRequirementId, row.projectId,
    );
    await this.assertParent(dto.parentRequirementId, row.projectId, id);

    const data: Record<string, unknown> = {};
    for (const key of [
      'hierarchyId',
      'epicId',
      'sprintId',
      'clientRequirementId',
      'parentRequirementId',
      'title',
      'description',
      'type',
      'complexity',
      'priority',
      'status',
      'progress',
      'reusable',
      'assignedTo',
      'assignedToNames',
      'tags',
      'linkedProjectIds',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }

    // A body of nothing but `progress` (+ optionally `status`) is the task
    // rollup, not an edit — see patchRollup. `progress` has to be PRESENT for
    // that: a `status` on its own is the sprint board moving an FR card
    // between columns (getFRStatusForBoard in sprint-board.tsx), which is a
    // human decision and keeps needing `requirement:write`.
    const fields = Object.keys(data);
    if (data.progress !== undefined && fields.every((f) => FR_ROLLUP_FIELDS.has(f))) {
      return this.patchRollup(user, id, row, data);
    }
    return this.update(user, id, data);
  }

  /**
   * The FR's rollup as its task set actually stands.
   *
   * Mirrors `calculateFRStatusFromTasks` in the client's
   * use-functional-requirement.ts, including the two states a task set cannot
   * express: DEPLOYED is terminal (nothing about a set of tasks means
   * "shipped"), and an FR with no tasks keeps whatever a human set rather than
   * snapping back to DRAFT.
   *
   * "All tasks done" is a COUNT comparison (`done === total`), never
   * `progress === 100` — Math.round reports 100% at 240 of 241.
   */
  private async deriveRollup(id: string, currentStatus: string) {
    const [total, done, active] = await Promise.all([
      this.prisma.task.count({ where: { functionalRequirementId: id } }),
      this.prisma.task.count({ where: { functionalRequirementId: id, status: 'DONE' } }),
      this.prisma.task.count({
        where: { functionalRequirementId: id, status: { in: ['IN_PROGRESS', 'REVIEW'] } },
      }),
    ]);
    const status =
      currentStatus === 'DEPLOYED'
        ? 'DEPLOYED'
        : total === 0
          ? currentStatus || 'DRAFT'
          : done === total
            ? 'TESTED'
            : active > 0
              ? 'IMPLEMENTED'
              : 'APPROVED';
    return { progress: total > 0 ? Math.round((done / total) * 100) : 0, status };
  }

  /**
   * The same carve-out `EpicsService.patchRollup` already has, for the same
   * reason and one level down the hierarchy.
   *
   * An FR's `progress` and `status` are its task rollup: the FR detail dialog
   * labels both "(Auto-calculated from tasks)" and offers neither as an input,
   * and the client re-derives them after every task create, status change and
   * delete (`updateParentProgress`). Writing them still required
   * `requirement:write`, which the four delivery roles do not hold — they hold
   * `task:update`. So an ordinary task edit by a developer, on any task with an
   * FR, produced a 403 PATCH /functional_requirements/<id> in the console, an
   * error log, and a warning toast telling the user their progress was stale —
   * every single time, for a change that was theirs to make and had already
   * been saved. The FR's own rollup then stayed frozen at whatever a manager
   * last triggered.
   *
   * So a rollup-shaped body is additionally accepted from anyone holding
   * `task:update` — the permission behind the task change that caused it. For
   * THAT caller both columns are recomputed here from the tasks and the
   * submitted numbers are ignored, so `task:update` cannot be used to declare a
   * requirement tested or shipped; the response carries the derived values.
   *
   * A `requirement:write` caller keeps the `progress` it sent, but its `status`
   * is recomputed too: `progress` is the measured half of the pair, `status`
   * the derived half, and the two must not contradict each other. Deliberate
   * status moves (the sprint board's DEPLOYED) send a `status` with no
   * `progress` and never reach this method.
   */
  private async patchRollup(
    user: User,
    id: string,
    row: FunctionalRequirement,
    submitted: Record<string, unknown>,
  ) {
    const workspaceId = this.workspaceOf(row);
    const privileged = await this.access.can(user, workspaceId, this.updatePermission);
    if (!privileged) {
      await this.access.assertPermission(user, workspaceId, Permission.TaskUpdate);
    }

    const derived = await this.deriveRollup(id, row.status);
    const data: Record<string, unknown> = privileged
      ? { ...submitted, status: derived.status }
      : derived;

    const updated = (await this.delegate.update({ where: { id }, data })) as FunctionalRequirement;
    await this.recordAudit(
      user,
      workspaceId,
      'updated',
      id,
      updated as unknown as Record<string, unknown>,
      Object.keys(data),
    );
    return this.map(updated);
  }
}
