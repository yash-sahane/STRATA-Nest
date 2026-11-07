import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type ListQuerySpec, toDate } from '@strata/common';
import { todayIn, workScheduleOf } from '@strata/config';
import { TaskEvents } from '@strata/shared';
import { PrismaService, refreshDeliveryRollups } from '@strata/prisma';
import type { Prisma, Task, User } from '@prisma/client';
import type { AuditAction } from '../activity/audit-writer';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { createWithFreeHierarchyId } from '../generation/hierarchy-id.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { emitDomainEvent } from '../workspaces/domain-event';
import { assertLinkInProject, assertProjectInWorkspace } from '../workspaces/workspace-refs';
import { assigneeNamesFor } from '../workspaces/assignee-names';
import type {
  CreateTaskDto,
  TaskDependencyDto,
  TaskDependencyType,
  UpdateTaskDto,
} from './dto';
import { taskResponse } from './mappers';
import { tellPeople } from '../notifications/notice';
import { mintTaskHierarchyId } from '../generation/hierarchy-ids';

@Injectable()
export class TasksService extends ScopedCrudService<Task, ReturnType<typeof taskResponse>> {
  protected readonly model = 'task';
  /** Carries a `version` column, so a stale save is refused rather than applied. */
  protected override readonly versioned = true;
  protected readonly auditEntity = 'task';
  protected readonly writePermission: PermissionKey = Permission.TaskWrite;
  /** Filing a task is delivery work (task:create); deleting one stays task:write. */
  protected override get createPermission(): PermissionKey {
    return Permission.TaskCreate;
  }
  /** Editing an existing task is open to the delivery roles too. See DELIVERY
   *  in authz/permissions.ts. */
  protected override get updatePermission(): PermissionKey {
    return Permission.TaskUpdate;
  }
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      sprintId: { field: 'sprintId' },
      epicId: { field: 'epicId' },
      functionalRequirementId: { field: 'functionalRequirementId' },
      parentTaskId: { field: 'parentTaskId' },
      status: { field: 'status' },
      priority: { field: 'priority' },
      hierarchyId: { field: 'hierarchyId' },
      // A task's dependencies and parent, fetched by id instead of finding them
      // in a download of the whole workspace.
      id: { field: 'id' },
      title: { field: 'title' },
      // One person's tasks: their id is in `assigneeIds`.
      assigneeId: { field: 'assigneeIds', type: 'json-array' },
      // Deadline reminders filter on a dueDate range; without it here both
      // clauses were silently dropped and only the first page of tasks (ordered
      // by createdAt) was ever considered for a reminder.
      dueDate: { field: 'dueDate', type: 'date' },
      completedAt: { field: 'completedAt', type: 'date' },
      updatedAt: { field: 'updatedAt', type: 'date' },
    },
    sortable: {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      position: 'position',
      hierarchyId: 'hierarchyId',
      dueDate: 'dueDate',
      title: 'title',
    },
    search: ['title', 'hierarchyId', 'description'],
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: Task) {
    return taskResponse(row);
  }

  private readonly logger = new Logger('Tasks');

  /**
   * Bring the summaries above a task back in line with it: the status and
   * progress of the requirement and the epic it is, or was, under.
   *
   * The browser used to do this with a second request after its save, so the
   * summaries were only as current as the last browser to finish one — and a
   * change made by anything else was never summed at all. Pass the task as it
   * was and as it is; a task that changed parent moves both sets of totals.
   *
   * It runs after the task is saved and never fails the save: the totals are
   * bookkeeping about a change that has already happened.
   */
  private async rollUp(
    ...tasks: Array<{ functionalRequirementId?: unknown; epicId?: unknown } | null | undefined>
  ): Promise<void> {
    await refreshDeliveryRollups(
      this.prisma,
      {
        functionalRequirementIds: tasks.map((t) => t?.functionalRequirementId as string | undefined),
        epicIds: tasks.map((t) => t?.epicId as string | undefined),
      },
      (error, kind, id) =>
        this.logger.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`),
    );
  }

  /**
   * Tell the people a write concerns — see WorkNotificationSubscriber. Emitted
   * after the write, from here, so it happens whichever screen (or script) made
   * the change and cannot be skipped or invented by a client.
   */
  private announceChanges(user: User, before: Task, data: Record<string, unknown>): void {
    const ref = {
      workspaceId: before.workspaceId,
      projectId: before.projectId,
      taskId: before.id,
      title: typeof data.title === 'string' ? data.title : before.title,
      hierarchyId: typeof data.hierarchyId === 'string' ? data.hierarchyId : before.hierarchyId,
      actorId: user.id,
      actorName: user.name || user.email,
    };
    const was = idList(before.assigneeIds);
    const now = data.assigneeIds !== undefined ? idList(data.assigneeIds) : was;
    const added = now.filter((id) => !was.includes(id));
    if (added.length > 0) {
      emitDomainEvent(this.events, TaskEvents.Assigned, before.workspaceId, {
        ...ref,
        assigneeIds: added,
      });
    }
    // Taken OFF a task. Being put on one has always been announced; coming off
    // was not, so the task simply left "My tasks" with nothing to say why.
    const removed = was.filter((id) => !now.includes(id));
    tellPeople(this.events, {
      workspaceId: before.workspaceId,
      recipients: removed,
      actorId: user.id,
      type: 'TASK_UNASSIGNED',
      title: `No longer assigned: ${ref.title}`,
      message: `${ref.actorName} took you off "${ref.title}" (${ref.hierarchyId})`,
      projectId: before.projectId,
      relatedEntityId: before.id,
      relatedEntityType: 'TASK',
    });
    if (typeof data.status === 'string' && data.status !== before.status) {
      emitDomainEvent(this.events, TaskEvents.StatusChanged, before.workspaceId, {
        ...ref,
        from: before.status,
        to: data.status,
        assigneeIds: now,
        sprintId: typeof data.sprintId === 'string' ? data.sprintId : before.sprintId,
      });
    }
    if (typeof data.priority === 'string' && data.priority !== before.priority) {
      emitDomainEvent(this.events, TaskEvents.PriorityChanged, before.workspaceId, {
        ...ref,
        priority: data.priority,
        assigneeIds: now,
      });
    }
  }
  /**
   * Every assignee must be a member of the workspace the task lives in.
   *
   * Unvalidated, `assigneeIds` accepted arbitrary strings: a task stored
   * `["definitely-not-a-user"]` with a 201, and the board then rendered a chip
   * for somebody who does not exist — or, worse, silently assigned work to an
   * id belonging to another tenant's account.
   */
  /** The sprint and epic a requirement sits in — what a task under it inherits. */
  private async requirementLinks(
    functionalRequirementId?: string | null,
  ): Promise<{ sprintId: string | null; epicId: string | null } | null> {
    if (!functionalRequirementId) return null;
    return this.prisma.functionalRequirement.findUnique({
      where: { id: functionalRequirementId },
      select: { sprintId: true, epicId: true },
    });
  }

  private async sprintStatus(sprintId: string): Promise<string | null> {
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { status: true },
    });
    return sprint?.status ?? null;
  }

  /** A completed sprint is a record of what it delivered: nothing joins it. */
  private async assertSprintOpen(sprintId?: string | null): Promise<void> {
    if (!sprintId) return;
    if ((await this.sprintStatus(sprintId)) === 'COMPLETED') {
      throw new BadRequestException(
        'That sprint is completed. Work cannot be added to a sprint that has already closed.',
      );
    }
  }

  private async assertAssignable(workspaceId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: unique }, status: 'ACTIVE' },
      select: { userId: true },
    });
    const ok = new Set(members.map((m) => m.userId));
    const bad = unique.filter((id) => !ok.has(id));
    if (bad.length > 0) {
      throw new BadRequestException(
        `Cannot assign this task to somebody who is not an active member of the workspace.`,
      );
    }
  }

  /**
   * A parent chain must not close into a loop.
   *
   * `assertNoSelfReference` catches only the one-step case (A parenting itself).
   * A two-node cycle was accepted: make B a child of A, then make A a child of B
   * and both rows point at each other. Nothing that walks the tree — the
   * deletion cascade, the hierarchy-id builder — can terminate on that.
   */
  private async assertNoParentCycle(id: string, parentTaskId: string): Promise<void> {
    let cursor: string | null = parentTaskId;
    // The chain cannot be longer than the task count; this bound is a
    // belt-and-braces stop in case the data is already looped.
    for (let hops = 0; cursor && hops < 100; hops += 1) {
      if (cursor === id) {
        throw new BadRequestException(
          'That would make the two tasks parents of each other. Pick a different parent task.',
        );
      }
      const next: { parentTaskId: string | null } | null = await this.prisma.task.findUnique({
        where: { id: cursor },
        select: { parentTaskId: true },
      });
      cursor = next?.parentTaskId || null;
    }
  }

  async create(user: User, dto: CreateTaskDto) {
    const assignees = dto.assigneeIds ?? [];
    // Every parent named here is a soft FK. Without these a task could be filed
    // in your own workspace while pointing at a project in one you cannot even
    // read — and `GET /tasks?projectId=…`, the exact query the board sends,
    // then handed that task to the other workspace's members.
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    await assertLinkInProject(this.prisma, 'sprint', 'Sprint', dto.sprintId, dto.projectId);
    await assertLinkInProject(this.prisma, 'epic', 'Epic', dto.epicId, dto.projectId);
    await assertLinkInProject(
      this.prisma, 'functionalRequirement', 'Functional requirement',
      dto.functionalRequirementId, dto.projectId,
    );
    await assertLinkInProject(this.prisma, 'task', 'Parent task', dto.parentTaskId, dto.projectId);
    await this.assertAssignable(dto.workspaceId, assignees);
    /*
     * A task follows the requirement it belongs to: into its sprint, and under
     * its epic. Both used to be whatever the form happened to send. The form has
     * no sprint field at all, so a task added under a requirement that was
     * already in the running sprint was created outside it and could never be
     * put in — and its epic was a second, independent choice, which is how an
     * epic came to list requirements with work in progress beside "Tasks 0 / 0".
     * What the caller names explicitly still wins.
     */
    const follows = await this.requirementLinks(dto.functionalRequirementId);
    // Naming the sprint is planning — the rule PATCH has for moving a task into
    // one. Following a requirement into its sprint is not: that was planned
    // when the requirement was.
    if (dto.sprintId) {
      await this.access.assertPermission(user, dto.workspaceId, Permission.PlanningWrite);
    }
    const followed = dto.sprintId ? '' : follows?.sprintId || '';
    const followedStatus = followed ? await this.sprintStatus(followed) : null;
    // Not into a sprint that has closed. A delivered requirement stays in the
    // sprint that delivered it, so following it there refused every follow-up
    // task ("That sprint is completed") — the new task is left unplanned
    // instead, in the backlog, for whoever plans the next sprint. A closed
    // sprint the caller NAMES is still refused, below.
    const sprintId = dto.sprintId || (followedStatus === 'COMPLETED' ? '' : followed);
    const epicId = dto.epicId || follows?.epicId || '';
    await this.assertSprintOpen(dto.sprintId);
    // Joining a sprint that is already running means starting on its board,
    // which has no Backlog column — the same move sprint start makes.
    const joinsRunningSprint = Boolean(followed) && followedStatus === 'ACTIVE';
    const status =
      joinsRunningSprint && (dto.status ?? 'BACKLOG') === 'BACKLOG'
        ? 'TODO'
        : (dto.status ?? 'BACKLOG');
    // A brand-new task cannot have been reviewed, so it cannot be done. PATCH
    // has enforced the REVIEW gate all along (patchStatus), but create accepted
    // `status: 'DONE'` outright and stamped completedAt — the New Task dialog
    // even offered it. That is the same rule, skipped by the other door.
    if (dto.status === 'DONE') {
      throw new BadRequestException(
        'A new task cannot start out done — it has to pass through Review first.',
      );
    }
    const fields = {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      sprintId,
      epicId,
      functionalRequirementId: dto.functionalRequirementId ?? '',
      parentTaskId: dto.parentTaskId ?? '',
      title: dto.title,
      description: dto.description ?? '',
      status,
      priority: dto.priority ?? 'MEDIUM',
      completedAt: dto.status === 'DONE' ? new Date() : null,
      assigneeIds: assignees,
      // Resolved here, never taken from the request — see assigneeNamesFor.
      assigneeNames: await assigneeNamesFor(this.prisma, assignees),
      // Whoever handed the work out is whoever created it with people on it.
      assignedBy: assignees.length > 0 ? user.id : '',
      assignedByName: assignees.length > 0 ? user.name || user.email : '',
      createdById: user.id,
      createdByName: user.name ?? '',
      dueDate: toDate(dto.dueDate, 'Due date'),
      estimatedHours: dto.estimatedHours ?? null,
      labels: dto.labels ?? [],
      // Left out, at the end of the board — where a new card goes.
      position: dto.position ?? (await this.endOfBoard(dto.projectId)),
      // Always empty: dependencies are two-sided and are written only by
      // writeDependency (see CreateTaskDto).
      blockedBy: [],
      blocks: [],
    };
    // The server mints the id, one past the highest in use (a caller may still
    // name its own). Two creates at once can mint the same one; the second takes
    // the next free id rather than being refused — see createWithFreeHierarchyId.
    const created = await createWithFreeHierarchyId(
      dto.hierarchyId ||
        (await mintTaskHierarchyId(this.prisma, {
          projectId: dto.projectId,
          title: dto.title,
          functionalRequirementId: fields.functionalRequirementId || undefined,
          parentTaskId: fields.parentTaskId || undefined,
        })),
      async (hierarchyId) =>
        (await this.prisma.task.findFirst({
          where: { projectId: dto.projectId, hierarchyId },
          select: { id: true },
        })) !== null,
      (hierarchyId) => this.createIn(user, dto.workspaceId, { ...fields, hierarchyId }),
    );
    await this.rollUp({ functionalRequirementId: fields.functionalRequirementId, epicId });
    if (assignees.length > 0) {
      emitDomainEvent(this.events, TaskEvents.Assigned, dto.workspaceId, {
        workspaceId: dto.workspaceId,
        projectId: dto.projectId,
        taskId: created.id,
        title: dto.title,
        hierarchyId: created.hierarchyId,
        actorId: user.id,
        actorName: user.name || user.email,
        assigneeIds: [...new Set(assignees)],
      });
    }
    return created;
  }
  async patch(user: User, id: string, dto: UpdateTaskDto) {
    assertNoSelfReference(id, dto);
    const data: Record<string, unknown> = {};
    // blockedBy/blocks are deliberately NOT copyable here: each is only half of
    // an edge, so a PATCH of one side alone desynchronises the graph and skips
    // the cycle check. Use the dependency endpoints, which write both sides.
    const copy = [
      'hierarchyId', 'title', 'sprintId', 'epicId', 'functionalRequirementId', 'parentTaskId',
      'description', 'status', 'priority', 'assigneeIds', 'estimatedHours', 'labels',
      'position',
    ] as const;
    for (const k of copy) if (dto[k] !== undefined) data[k] = dto[k];
    if (dto.dueDate !== undefined) data.dueDate = toDate(dto.dueDate, 'Due date');
    if (dto.parentTaskId) await this.assertNoParentCycle(id, dto.parentTaskId);
    const nextAssignees = dto.assigneeIds;
    // The stored row — read only by a patch that changes who holds the task, what
    // it hangs from, or where it stands. A reorder (`position` alone) or a title
    // edit still costs no extra read.
    const relinks =
      dto.sprintId !== undefined ||
      dto.epicId !== undefined ||
      dto.functionalRequirementId !== undefined ||
      dto.parentTaskId !== undefined;
    const current =
      nextAssignees !== undefined ||
      relinks ||
      dto.status !== undefined ||
      dto.priority !== undefined ||
      // A drop is placed among the cards of the column it lands in.
      dto.placeBefore !== undefined
        ? await this.findScoped(user, id)
        : null;
    if (current) {
      /**
       * The checks `create` runs, by the other door. PATCH skipped every one of
       * them: a task could be handed to an id that is no member of the workspace
       * — another tenant's account included, whose name `namesFor` then wrote
       * into the row — or hung from a sprint, epic or requirement of a different
       * project.
       *
       * Only the people being ADDED are checked. Somebody who has since left the
       * workspace is still on the tasks they held, and that must not make the
       * rest of the assignee list uneditable.
       */
      if (nextAssignees !== undefined) {
        const held = idList(current.assigneeIds);
        await this.assertAssignable(
          current.workspaceId,
          nextAssignees.filter((assignee) => !held.includes(assignee)),
        );
      }
      // Moving an existing task into another sprint, epic or requirement is
      // planning — the planning page asks for planning:write to do the same by
      // requirement. task:update, which the delivery roles hold to work the
      // board, let them re-plan the running sprint from the task dialog.
      const replans =
        (dto.sprintId !== undefined && (dto.sprintId || '') !== (current.sprintId || '')) ||
        (dto.epicId !== undefined && (dto.epicId || '') !== (current.epicId || '')) ||
        (dto.functionalRequirementId !== undefined &&
          (dto.functionalRequirementId || '') !== (current.functionalRequirementId || ''));
      if (replans) {
        await this.access.assertPermission(user, current.workspaceId, Permission.PlanningWrite);
      }
      await assertLinkInProject(this.prisma, 'sprint', 'Sprint', dto.sprintId, current.projectId);
      await assertLinkInProject(this.prisma, 'epic', 'Epic', dto.epicId, current.projectId);
      await assertLinkInProject(
        this.prisma, 'functionalRequirement', 'Functional requirement',
        dto.functionalRequirementId, current.projectId,
      );
      await assertLinkInProject(
        this.prisma, 'task', 'Parent task', dto.parentTaskId, current.projectId,
      );
      // Moved under a different requirement: its sprint and epic come with it,
      // unless this same request says otherwise. See `create`.
      if (
        dto.functionalRequirementId &&
        dto.functionalRequirementId !== current.functionalRequirementId
      ) {
        const follows = await this.requirementLinks(dto.functionalRequirementId);
        if (follows) {
          if (dto.sprintId === undefined) {
            // Not into a sprint that has closed — see `create`: the task is
            // left unplanned rather than the move refused.
            const closed =
              Boolean(follows.sprintId) &&
              (await this.sprintStatus(follows.sprintId as string)) === 'COMPLETED';
            data.sprintId = closed ? '' : (follows.sprintId ?? '');
          }
          if (dto.epicId === undefined) data.epicId = follows.epicId ?? '';
        }
      }
      const nextSprintId = data.sprintId as string | undefined;
      if (nextSprintId && nextSprintId !== current.sprintId) {
        await this.assertSprintOpen(nextSprintId);
      }
      // Reopening work that a COMPLETED sprint recorded as finished takes it out
      // of that sprint. Left inside, it was open work in a sprint that will never
      // roll it out again, hidden from its assignee's list of things to do.
      if (
        dto.status !== undefined &&
        dto.status !== 'DONE' &&
        current.status === 'DONE' &&
        current.sprintId &&
        nextSprintId === undefined &&
        (await this.sprintStatus(current.sprintId)) === 'COMPLETED'
      ) {
        data.sprintId = '';
      }
    }
    if (current && dto.placeBefore !== undefined) {
      // Asked before placing: making room can renumber the column, and that is
      // a write somebody who may not move this card must not cause.
      await this.access.assertPermission(user, current.workspaceId, this.updatePermission);
      data.position = await this.placedPosition(
        current,
        dto.status ?? current.status,
        dto.placeBefore,
      );
    }
    if (nextAssignees !== undefined && current) {
      // The names are the server's (assigneeNamesFor), and so is "assigned by":
      // whoever changed the people last. It used to be whatever the form sent —
      // the creator, for good, however often the task changed hands.
      data.assigneeNames = await assigneeNamesFor(this.prisma, nextAssignees);
      const held = idList(current.assigneeIds);
      const changed =
        held.length !== nextAssignees.length || nextAssignees.some((x) => !held.includes(x));
      if (changed) {
        data.assignedBy = nextAssignees.length > 0 ? user.id : '';
        data.assignedByName = nextAssignees.length > 0 ? user.name || user.email : '';
      }
    }
    const result =
      current && dto.status !== undefined
        ? await this.patchStatus(user, current, dto.status, data, dto.basedOn)
        : await this.update(user, id, data, dto.basedOn);
    if (current) this.announceChanges(user, current, data);
    // Its status or its parents changed, so the totals above it did.
    if (
      current &&
      (data.status !== undefined ||
        data.functionalRequirementId !== undefined ||
        data.epicId !== undefined)
    ) {
      await this.rollUp(current, {
        functionalRequirementId: data.functionalRequirementId ?? current.functionalRequirementId,
        epicId: data.epicId ?? current.epicId,
      });
    }
    return result;
  }

  /**
   * Stamp `completedAt` on the transition INTO done and clear it on the way out,
   * and enforce the completion rules the product treats as binding.
   *
   * Both rules used to live ONLY in the browser (`useUpdateTask` /
   * `useUpdateTaskStatus`), where a direct `PATCH /tasks/{id}` with
   * `{status:'DONE'}` skipped them entirely — and where the role test was a
   * substring match (`role.includes('manager')`) that no custom role could
   * satisfy and no platform admin could pass. The server is the authority:
   *
   *  - a task must pass through REVIEW before it can be DONE;
   *  - completing one requires `task:write`, resolved through the same
   *    permission machinery as every other write (so custom roles and platform
   *    admins are answered correctly).
   *
   * `can()` is used rather than `assertPermission` deliberately: completion is a
   * business rule, so it must hold even where `RBAC_ENFORCED=false` relaxes
   * ordinary writes to the membership floor.
   *
   * Only a transition counts: re-saving an already-DONE task must not move the
   * timestamp, or completion trends drift forward on every unrelated edit — and
   * must not be re-gated, or an unrelated title edit on a finished task fails.
   */
  private async patchStatus(
    user: User,
    current: Task,
    status: string,
    data: Record<string, unknown>,
    basedOn?: Record<string, unknown>,
  ) {
    if (status === 'DONE' && current.status !== 'DONE') {
      if (current.status !== 'REVIEW') {
        throw new BadRequestException(
          'Tasks must be reviewed before they can be marked done. Move the task to Review first.',
        );
      }
      if (!(await this.access.can(user, this.workspaceOf(current), Permission.TaskWrite))) {
        throw new ForbiddenException('Only managers or assistant managers can mark tasks as done.');
      }
      data.completedAt = new Date();
    } else if (status !== 'DONE' && current.status === 'DONE') {
      // Done is a sign-off, so taking it back is the same decision in reverse. A
      // role that could not mark a task done could still drag a finished one back
      // to To Do, undoing the review it was not allowed to give.
      if (!(await this.access.can(user, this.workspaceOf(current), Permission.TaskWrite))) {
        throw new ForbiddenException(
          'Only managers or assistant managers can reopen a finished task.',
        );
      }
      data.completedAt = null;
    }
    return this.update(user, current.id, data, basedOn);
  }

  /**
   * One past the highest position in the project: the end of every column.
   *
   * Not the task count, which is what a new task used to be numbered by. A card
   * dragged to the bottom of a column is placed past the last card there
   * (placedPosition), so positions can run past the count — and a new task
   * numbered by it then appeared in the middle of the column instead of last.
   */
  private async endOfBoard(projectId: string): Promise<number> {
    const { _max } = await this.prisma.task.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    return _max.position === null ? 0 : Math.floor(_max.position) + 1;
  }

  /**
   * The position for a card dropped in front of `before` in its project's
   * `status` column — or at the bottom, for '' or for a card that is no longer
   * in that column (somebody moved it while this one was in the air).
   *
   * `position` is a float and is only ever compared within a column, so the
   * card goes halfway between the two cards it was dropped between and nothing
   * else is written: one drop, one write. Both boards used to renumber instead.
   * The tasks page PATCHed every card in the column, one request each — past a
   * hundred-odd cards that ran into the request limit and left the column half
   * renumbered, with duplicates. The sprint board wrote the card's rank among
   * that sprint's cards over positions that count across the whole project, so
   * the card landed somewhere else entirely.
   *
   * Out of room — two cards share a position (rows from before this, or two
   * drops into one gap at the same instant) or a gap has been halved past what
   * a float can tell apart — the column is renumbered 0, 1, 2… in the order it
   * already has, with the slot left free, in one transaction. That is rare.
   */
  private async placedPosition(task: Task, status: string, before: string): Promise<number> {
    const columnOf = (client: Prisma.TransactionClient) =>
      client.task.findMany({
        where: { projectId: task.projectId, status, id: { not: task.id } },
        select: { id: true, position: true },
        // The same order the boards draw ties in (lib/task-sort.ts).
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
    const slotIn = (cards: Array<{ id: string }>) => {
      const at = before ? cards.findIndex((card) => card.id === before) : -1;
      return at >= 0 ? at : cards.length;
    };
    const column = await columnOf(this.prisma);
    if (column.length === 0) return task.position;
    const at = slotIn(column);
    const room = positionBetween(column[at - 1]?.position, column[at]?.position);
    if (room !== null) return room;
    const lockKey = `order:${task.projectId}:${status}`;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
        const fresh = await columnOf(tx);
        const slot = slotIn(fresh);
        // updateMany, one card at a time: each card gets its own number, and
        // updateMany stays out of the realtime hook — the moved card's own
        // write is the one frame every open board refetches on.
        for (const [index, card] of fresh.entries()) {
          await tx.task.updateMany({
            where: { id: card.id },
            data: { position: index < slot ? index : index + 1, version: { increment: 1 } },
          });
        }
        return slot;
      },
      // A long column is one statement per card; the default 5s is for a click.
      { timeout: 30_000 },
    );
  }

  /**
   * A card moved within its column is not news. Every drag wrote a "task
   * updated" row to the activity trail, so an afternoon of tidying the board
   * buried the edits people go there to find. A move to another column changes
   * `status` as well, and is still recorded.
   */
  protected override async recordAudit(
    user: User,
    workspaceId: string | undefined,
    action: AuditAction,
    entityId: string,
    row?: Record<string, unknown>,
    changedFields?: string[],
  ): Promise<void> {
    if (
      action === 'updated' &&
      changedFields !== undefined &&
      changedFields.length > 0 &&
      changedFields.every((field) => field === 'position')
    ) {
      return;
    }
    await super.recordAudit(user, workspaceId, action, entityId, row, changedFields);
  }

  /**
   * Each person's tasks in a workspace: how many, how many finished, how many
   * past their due day and not done. The team page and the assignee picker
   * used to download every task in the workspace — twice, under two cache
   * keys — to count these.
   *
   * "Overdue" is by the workspace's business day: a task's due DAY is the
   * calendar date its due date falls on in the workspace's zone, and it is
   * overdue once that day is before today there — due today is not overdue,
   * as the dashboard and analytics (frontend lib/task-dates.ts) already say.
   * This compared the due INSTANT with today's UTC-midnight marker instead.
   * The browser stores a due date as the picker's local midnight, so in India a
   * task due on the 13th is 18:30 UTC on the 12th, and it was counted overdue
   * all through the day it was due. `due_date` holds UTC wall-clock time (a
   * timestamp without zone), hence the first AT TIME ZONE.
   */
  async summary(user: User, workspaceId: string) {
    if (!workspaceId) throw new BadRequestException('workspaceId is required.');
    await this.access.assertMember(user, workspaceId);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const { timeZone } = workScheduleOf(workspace?.settings);
    const today = todayIn(timeZone);
    const rows = await this.prisma.$queryRaw<
      Array<{ user_id: string; total: bigint; done: bigint; overdue: bigint }>
    >`
      SELECT a.user_id,
             count(*) AS total,
             count(*) FILTER (WHERE t.status = 'DONE') AS done,
             count(*) FILTER (
               WHERE t.status <> 'DONE'
                 AND ((t.due_date AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text)::date
                     < ${today}::date
             ) AS overdue
        FROM tasks_task t
        CROSS JOIN LATERAL jsonb_array_elements_text(t.assignee_ids) AS a(user_id)
       WHERE t.workspace_id = ${workspaceId}
         AND jsonb_typeof(t.assignee_ids) = 'array'
       GROUP BY a.user_id`;
    return {
      byAssignee: rows.map((row) => {
        const total = Number(row.total);
        const done = Number(row.done);
        return {
          userId: row.user_id,
          totalTasks: total,
          activeTasks: total - done,
          completedTasks: done,
          overdueTasks: Number(row.overdue),
        };
      }),
    };
  }

  /** Record a dependency edge (both sides, one transaction, cycle-checked). */
  addDependency(user: User, id: string, dto: TaskDependencyDto) {
    return this.writeDependency(user, id, dto.targetTaskId, dto.type, 'add');
  }

  /** Drop a dependency edge (both sides, one transaction). */
  removeDependency(user: User, id: string, targetTaskId: string, type: TaskDependencyType) {
    return this.writeDependency(user, id, targetTaskId, type, 'remove');
  }

  /**
   * `blockedBy`/`blocks` are two halves of ONE edge. The client used to PATCH
   * each half separately, so a failure between the two calls left the graph
   * asymmetric (A says it is blocked by B, B does not know it blocks A) and no
   * cycle check ran anywhere the server could see. Both halves are written in a
   * single transaction here, after the walk below proves the edge is acyclic.
   *
   * The transaction holds a per-workspace advisory lock and reads both rows and
   * the graph INSIDE it. Computed from rows read before it, two edges added to
   * one task at once each wrote "the list plus mine" and one vanished, and the
   * two halves of a cycle added at the same instant both passed the walk.
   * Dependency edits are rare and the lock is held for a few small reads, so
   * serialising them per workspace costs nothing anybody would notice.
   */
  private async writeDependency(
    user: User,
    id: string,
    targetTaskId: string,
    type: TaskDependencyType,
    mode: 'add' | 'remove',
  ) {
    if (id === targetTaskId) {
      throw new BadRequestException('A task cannot depend on itself');
    }
    // findScoped 404s for a task outside the caller's workspaces, so neither end
    // of the edge can be a task the caller cannot already see.
    const [task, target] = await Promise.all([
      this.findScoped(user, id),
      // Removing an edge to a task that has since been deleted must still work.
      mode === 'remove'
        ? this.findScopedUnlessGone(user, targetTaskId)
        : this.findScoped(user, targetTaskId),
    ]);
    if (target && task.workspaceId !== target.workspaceId) {
      throw new BadRequestException('Tasks in different workspaces cannot depend on each other');
    }
    // A dependency edge changes two existing tasks, so it is an update.
    await this.access.assertPermission(user, task.workspaceId, this.updatePermission);
    const lockKey = `deps:${task.workspaceId}`;
    if (!target) return this.dropDanglingEdge(task, targetTaskId, type, lockKey);

    // Normalise to one direction: `blocked` waits on `blocker`.
    const [blockedId, blockerId] =
      type === 'blockedBy' ? [task.id, target.id] : [target.id, task.id];

    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
      const [blocked, blocker] = await Promise.all([
        tx.task.findUnique({ where: { id: blockedId }, select: { blockedBy: true } }),
        tx.task.findUnique({ where: { id: blockerId }, select: { blocks: true } }),
      ]);
      if (!blocked || !blocker) throw new NotFoundException('Not found.');
      if (mode === 'add') {
        await assertNoCycle(tx, task.workspaceId, blockedId, blockerId);
      }
      const nextBlockedBy =
        mode === 'add'
          ? withId(idList(blocked.blockedBy), blockerId)
          : idList(blocked.blockedBy).filter((x) => x !== blockerId);
      const nextBlocks =
        mode === 'add'
          ? withId(idList(blocker.blocks), blockedId)
          : idList(blocker.blocks).filter((x) => x !== blockedId);
      return Promise.all([
        tx.task.update({
          where: { id: blockedId },
          data: { blockedBy: nextBlockedBy, version: { increment: 1 } },
        }),
        tx.task.update({
          where: { id: blockerId },
          data: { blocks: nextBlocks, version: { increment: 1 } },
        }),
      ]);
    });
    const addressed = rows.find((r) => r.id === id) ?? rows[0];
    return this.map(addressed);
  }

  /**
   * The task with this id if the caller may see it, or null when no task has
   * that id at all. A task that exists but is not the caller's to see is still
   * a 404, as it is everywhere else.
   */
  private async findScopedUnlessGone(user: User, id: string): Promise<Task | null> {
    try {
      return await this.findScoped(user, id);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      const exists = await this.prisma.task.findUnique({ where: { id }, select: { id: true } });
      if (exists) throw error;
      return null;
    }
  }

  /**
   * Take an id that names no task any more off a task's dependency list.
   *
   * There is no far half to clear — that task is gone — so this is the one edge
   * written from a single side. Deleting a task used to leave its id behind on
   * the tasks linked to it, and because removing an edge looked the far end up
   * first, that id answered 404 for good: a dependency nobody could see in the
   * dialog, still counted on the card, and impossible to remove.
   */
  private async dropDanglingEdge(
    task: Task,
    goneId: string,
    type: TaskDependencyType,
    lockKey: string,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
      const fresh = await tx.task.findUnique({
        where: { id: task.id },
        select: { blockedBy: true, blocks: true },
      });
      if (!fresh) throw new NotFoundException('Not found.');
      const ids = idList(type === 'blockedBy' ? fresh.blockedBy : fresh.blocks);
      if (!ids.includes(goneId)) return null;
      const next = ids.filter((x) => x !== goneId);
      return tx.task.update({
        where: { id: task.id },
        data:
          type === 'blockedBy'
            ? { blockedBy: next, version: { increment: 1 } }
            : { blocks: next, version: { increment: 1 } },
      });
    });
    return this.map(row ?? task);
  }
}

/**
 * Reject `blocked` → `blocker` if `blocker` already waits (transitively) on
 * `blocked`. Breadth-first over the workspace's `blockedBy` graph: a visited
 * set makes it terminate on an already-cyclic graph, and NODE_BUDGET bounds
 * the work so one request can never walk an unbounded number of rows.
 * Scope is the workspace, so cross-PROJECT edges are checked too — the
 * dependency UI offers them and labels them "Cross-project".
 *
 * Runs on the dependency transaction, under its workspace lock, so no other
 * edge can be added while the walk reads.
 */
async function assertNoCycle(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  blockedId: string,
  blockerId: string,
): Promise<void> {
  const NODE_BUDGET = 1000;
  const visited = new Set<string>([blockerId]);
  let frontier = [blockerId];
  while (frontier.length > 0) {
    const rows = await tx.task.findMany({
      where: { workspaceId, id: { in: frontier } },
      select: { id: true, blockedBy: true },
    });
    const next: string[] = [];
    for (const row of rows) {
      for (const dep of idList(row.blockedBy)) {
        if (dep === blockedId) {
          throw new BadRequestException('This would create a circular dependency');
        }
        if (!visited.has(dep)) {
          visited.add(dep);
          next.push(dep);
        }
      }
    }
    if (visited.size > NODE_BUDGET) {
      throw new BadRequestException('Dependency chain is too large to verify');
    }
    frontier = next;
  }
}

/** JSON id column → string[] (the column is `Json`, so it can hold anything). */
function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function withId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/**
 * A position strictly between two neighbours — either may be missing, at the
 * top or the bottom of a column — or null when no float lies between them.
 */
function positionBetween(above: number | undefined, below: number | undefined): number | null {
  if (above === undefined && below === undefined) return 0;
  if (above === undefined) return (below as number) - 1;
  if (below === undefined) return above + 1;
  const middle = above + (below - above) / 2;
  return above < middle && middle < below ? middle : null;
}

/**
 * A task that parents itself is a one-node cycle: the subtask tree never
 * terminates. Rejected here with no extra reads.
 *
 * Dependency arrays are refused outright — writing one side of an edge through
 * a plain PATCH is what left the graph asymmetric and unchecked in the first
 * place, so callers are sent to the transactional endpoints instead.
 */
function assertNoSelfReference(id: string, dto: UpdateTaskDto): void {
  if (dto.parentTaskId === id) {
    throw new BadRequestException('A task cannot be its own parent');
  }
  if (dto.blockedBy !== undefined || dto.blocks !== undefined) {
    throw new BadRequestException(
      'Task dependencies are managed through /tasks/{id}/dependencies',
    );
  }
}
