import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type ListQuerySpec } from '@strata/common';
import { RequirementEvents } from '@strata/shared';
import {
  CLIENT_REQUIREMENT_DERIVED_STATUSES,
  PrismaService,
  refreshDeliveryRollups,
} from '@strata/prisma';
import type { ClientRequirement, FunctionalRequirement, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
// The hierarchy-id rules live in one tested unit (the generation module owns
// them); requirements imports the pure helpers rather than restating them.
import { createWithFreeHierarchyId } from '../generation/hierarchy-id.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { emitDomainEvent } from '../workspaces/domain-event';
import { assertProjectInWorkspace } from '../workspaces/workspace-refs';
import { assigneeNamesFor } from '../workspaces/assignee-names';
import type {
  CreateClientRequirementDto,
  CreateFunctionalRequirementDto,
  UpdateClientRequirementDto,
  UpdateFunctionalRequirementDto,
} from './dto';
import { clientRequirementResponse, functionalRequirementResponse } from './mappers';
import { RequirementTasks } from './requirement-tasks';
import { tellPeople } from '../notifications/notice';
import { mintRequirementHierarchyId } from '../generation/hierarchy-ids';

/** The roll-up after a save is bookkeeping: a failure is logged, never the save's. */
const rollupLog = new Logger('RequirementRollups');
const logRollupFailure = (error: unknown, kind: string, id: string): void =>
  rollupLog.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`);

/** Depth cap for the parent walk — a malformed legacy chain must not spin. */
const MAX_PARENT_DEPTH = 50;

@Injectable()
export class ClientRequirementsService extends ScopedCrudService<
  ClientRequirement,
  ReturnType<typeof clientRequirementResponse>
> {
  protected readonly model = 'clientRequirement';
  /** Carries a `version` column, so a stale save is refused rather than applied. */
  protected override readonly versioned = true;
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
    search: ['title', 'clientName', 'description'],
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: ClientRequirement) {
    return clientRequirementResponse(row);
  }
  async create(user: User, dto: CreateClientRequirementDto) {
    await this.access.assertPermission(user, dto.workspaceId, this.writePermission);
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    const created = await this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      title: dto.title,
      description: dto.description ?? '',
      clientName: dto.clientName ?? '',
      priority: dto.priority ?? 'MEDIUM',
      status: dto.status ?? 'DRAFT',
      createdById: user.id,
      createdByName: user.name ?? '',
    });
    emitDomainEvent(this.events, RequirementEvents.ClientRequirementCreated, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      entityId: created.id,
      title: dto.title,
      actorId: user.id,
      actorName: user.name || user.email,
    });
    return created;
  }
  async patch(user: User, id: string, dto: UpdateClientRequirementDto) {
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.clientName !== undefined) data.clientName = dto.clientName;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.status !== undefined) data.status = dto.status;
    const row = dto.status !== undefined ? await this.findScoped(user, id) : null;
    const statusChanged = row !== null && dto.status !== row.status;
    // In Progress and Completed are what its functional requirements say once
    // it has some (rollups.ts) — not a person's to declare over them.
    if (
      statusChanged &&
      CLIENT_REQUIREMENT_DERIVED_STATUSES.includes(dto.status as string) &&
      (await this.prisma.functionalRequirement.count({ where: { clientRequirementId: id } })) > 0
    ) {
      throw new BadRequestException(
        'This client requirement has functional requirements: it moves to In Progress and ' +
          'Completed as they do. Approve it, and its progress follows the work.',
      );
    }
    const saved = await this.update(user, id, data, dto.basedOn);
    if (!statusChanged) return saved;
    // Approved just now, over work already under way: it says so at once.
    await refreshDeliveryRollups(this.prisma, { clientRequirementIds: [id] }, logRollupFailure);
    const fresh = await this.prisma.clientRequirement.findUnique({ where: { id } });
    return fresh ? this.map(fresh) : saved;
  }
}

@Injectable()
export class FunctionalRequirementsService extends ScopedCrudService<
  FunctionalRequirement,
  ReturnType<typeof functionalRequirementResponse>
> {
  /**
   * Assignees have to be ACTIVE members of the workspace — the rule tasks have
   * always had. Without it any user id on the platform could be put on a
   * requirement, and being assigned sends that person a notification and a
   * mail carrying a title the caller chose.
   */
  private async assertAssignable(workspaceId: string, ids: readonly unknown[]): Promise<void> {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
    if (unique.length === 0) return;
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: unique }, status: 'ACTIVE' },
      select: { userId: true },
    });
    if (members.length !== unique.length) {
      throw new BadRequestException(
        'Cannot assign this requirement to somebody who is not an active member of the workspace.',
      );
    }
  }

  private async assertSprintNotCompleted(sprintId?: string | null): Promise<void> {
    if (!sprintId) return;
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { status: true, name: true },
    });
    if (sprint?.status === 'COMPLETED') {
      throw new BadRequestException(
        `"${sprint.name}" is completed. A completed sprint is a record of what it delivered and cannot be re-planned.`,
      );
    }
  }

  protected readonly model = 'functionalRequirement';
  /** Carries a `version` column, so a stale save is refused rather than applied. */
  protected override readonly versioned = true;
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
    search: ['title', 'hierarchyId', 'description'],
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {
    super(prisma, access);
    this.tasks = new RequirementTasks(prisma, events);
  }
  /** What a requirement's move means for the tasks under it. */
  private readonly tasks: RequirementTasks;
  protected map(row: FunctionalRequirement) {
    return functionalRequirementResponse(row);
  }

  /** Tell the people newly put on a requirement — see WorkNotificationSubscriber. */
  private announceAssigned(
    user: User,
    fr: { workspaceId: string; projectId: string; id: string; title: string },
    assigneeIds: readonly string[],
  ): void {
    if (assigneeIds.length === 0) return;
    emitDomainEvent(this.events, RequirementEvents.FunctionalRequirementAssigned, fr.workspaceId, {
      workspaceId: fr.workspaceId,
      projectId: fr.projectId,
      entityId: fr.id,
      title: fr.title,
      actorId: user.id,
      actorName: user.name || user.email,
      assigneeIds: [...new Set(assigneeIds)],
    });
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
    await this.assertAssignable(dto.workspaceId, dto.assigneeIds ?? []);
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
      priority: dto.priority ?? 'MEDIUM',
      status: dto.status ?? 'DRAFT',
      // Its task roll-up: a requirement with no tasks has done none of them.
      progress: 0,
      assigneeIds: dto.assigneeIds ?? [],
      // The server's, from the ids — see assigneeNamesFor.
      assigneeNames: await assigneeNamesFor(this.prisma, dto.assigneeIds ?? []),
      createdById: user.id,
      createdByName: user.name ?? '',
    };

    // The server mints the id, one past the highest in use (a caller may still
    // name its own). Two creates at once can mint the same one; the second takes
    // the next free id rather than being refused — see createWithFreeHierarchyId.
    const created = await createWithFreeHierarchyId(
      dto.hierarchyId ||
        (await mintRequirementHierarchyId(this.prisma, {
          projectId: dto.projectId,
          title: dto.title,
          epicId: dto.epicId || undefined,
          parentRequirementId: dto.parentRequirementId || undefined,
        })),
      (hierarchyId) => this.hierarchyIdTaken(dto.projectId, hierarchyId),
      (hierarchyId) => this.createIn(user, dto.workspaceId, { ...data, hierarchyId }),
    );
    this.announceAssigned(
      user,
      { workspaceId: dto.workspaceId, projectId: dto.projectId, id: created.id, title: dto.title },
      data.assigneeIds,
    );
    // A requirement with no task yet is open work in its epic, and part of
    // what its client requirement has to deliver.
    if (dto.epicId || dto.clientRequirementId) {
      await refreshDeliveryRollups(
        this.prisma,
        { functionalRequirementIds: [created.id], epicIds: [dto.epicId] },
        logRollupFailure,
      );
    }
    return created;
  }
  async patch(user: User, id: string, dto: UpdateFunctionalRequirementDto) {
    const row = await this.findScoped(user, id);
    await this.assertLinkInProject('epic', 'Epic', dto.epicId, row.projectId);
    await this.assertLinkInProject('sprint', 'Sprint', dto.sprintId, row.projectId);
    await this.assertLinkInProject(
      'clientRequirement', 'Client requirement', dto.clientRequirementId, row.projectId,
    );
    await this.assertParent(dto.parentRequirementId, row.projectId, id);
    // Planning into, or out of, a sprint that has closed. The sprint's planning
    // page offered both, and either one rewrites what the sprint recorded: a
    // requirement added afterwards brings an unstarted task into a finished
    // sprint, and one taken out takes its finished tasks with it.
    if (dto.sprintId !== undefined && (dto.sprintId || '') !== (row.sprintId || '')) {
      // Putting a requirement into a sprint, or taking it out, plans the sprint:
      // its tasks go with it. requirement:write alone was enough, so a role
      // that writes requirements but plans nothing could re-plan a running
      // sprint, while one holding planning:write could start and close sprints
      // and not plan them.
      await this.access.assertPermission(user, row.workspaceId, Permission.PlanningWrite);
      await this.assertSprintNotCompleted(row.sprintId);
      await this.assertSprintNotCompleted(dto.sprintId);
    }

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
      'assigneeIds',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.assigneeIds !== undefined) {
      data.assigneeNames = await assigneeNamesFor(this.prisma, dto.assigneeIds);
    }

    if (dto.assigneeIds !== undefined) {
      // Only the people being ADDED: somebody already on the requirement who
      // has since left the workspace must not make it uneditable.
      const already = Array.isArray(row.assigneeIds) ? (row.assigneeIds as string[]) : [];
      await this.assertAssignable(
        row.workspaceId,
        dto.assigneeIds.filter((assignee) => !already.includes(assignee)),
      );
    }
    const result = await this.update(user, id, data, dto.basedOn);
    // The requirement is saved. Where it went, its tasks go: into the sprint,
    // out of it, under the other epic. See RequirementTasks.
    const saved = { ...row, ...data } as FunctionalRequirement;
    const sprintMoved =
      dto.sprintId !== undefined && (dto.sprintId || '') !== (row.sprintId || '');
    const epicMoved = dto.epicId !== undefined && (dto.epicId || '') !== (row.epicId || '');
    if (sprintMoved) await this.tasks.followSprint(user, saved, row.sprintId || '');
    if (epicMoved) await this.tasks.followEpic(saved, row.epicId || '');
    if (dto.assigneeIds !== undefined) {
      const held = Array.isArray(row.assigneeIds) ? (row.assigneeIds as string[]) : [];
      const takenOff = await this.tasks.followAssignees(user, saved, held);
      const title = dto.title ?? row.title;
      // Off the requirement, and so off its open tasks: say so, once each.
      const removed = held.filter((id) => !dto.assigneeIds!.includes(id));
      for (const person of new Set([...removed, ...takenOff.keys()])) {
        const tasks = takenOff.get(person) ?? 0;
        const onFr = removed.includes(person);
        tellPeople(this.events, {
          workspaceId: row.workspaceId,
          recipients: [person],
          actorId: user.id,
          type: 'FR_UNASSIGNED',
          title: onFr ? `No longer on: ${title}` : `Tasks handed on: ${title}`,
          message:
            `${user.name || user.email} took you off ${onFr ? '' : 'the tasks of '}"${title}"` +
            (tasks ? ` — ${tasks === 1 ? 'an open task of it was' : `${tasks} open tasks of it were`} handed on.` : '.'),
          projectId: row.projectId,
          relatedEntityId: row.id,
          relatedEntityType: 'FR',
        });
      }
      this.announceAssigned(
        user,
        {
          workspaceId: row.workspaceId,
          projectId: row.projectId,
          id: row.id,
          title: dto.title ?? row.title,
        },
        dto.assigneeIds.filter((assignee) => !held.includes(assignee)),
      );
    }
    // A status set by hand stands while the requirement has no tasks (and
    // DEPLOYED is the sign-off); with tasks, it goes where they are. Signed off
    // or not, its epic counts it as finished work or not — and its client
    // requirement, the one it left as well as the one it is under now.
    const statusChanged = dto.status !== undefined && dto.status !== row.status;
    const clientMoved =
      dto.clientRequirementId !== undefined &&
      (dto.clientRequirementId || '') !== (row.clientRequirementId || '');
    if (statusChanged || clientMoved) {
      await refreshDeliveryRollups(
        this.prisma,
        {
          functionalRequirementIds: [id],
          epicIds: [saved.epicId],
          clientRequirementIds: [row.clientRequirementId],
        },
        logRollupFailure,
      );
    }
    if (sprintMoved || epicMoved || statusChanged || clientMoved) {
      // Read again: a requirement that just got its first task has a status
      // and progress the response above was built before.
      const fresh = await this.prisma.functionalRequirement.findUnique({ where: { id } });
      if (fresh) return this.map(fresh);
    }
    return result;
  }
}
