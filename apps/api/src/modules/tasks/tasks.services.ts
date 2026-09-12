import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { type ListQuerySpec, toDate } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Label, Task, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { assertLinkInProject, assertProjectInWorkspace } from '../workspaces/workspace-refs';
import type {
  CreateLabelDto,
  CreateTaskDto,
  TaskDependencyDto,
  TaskDependencyType,
  UpdateLabelDto,
  UpdateTaskDto,
} from './dto';
import { labelResponse, taskResponse } from './mappers';

@Injectable()
export class TasksService extends ScopedCrudService<Task, ReturnType<typeof taskResponse>> {
  protected readonly model = 'task';
  protected readonly auditEntity = 'task';
  protected readonly writePermission: PermissionKey = Permission.TaskWrite;
  /** Editing an existing task is open to the delivery roles; creating and
   *  deleting one is not. See DELIVERY in authz/permissions.ts. */
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
      // Deadline reminders filter on a dueDate range; without it here both
      // clauses were silently dropped and only the first page of tasks (ordered
      // by createdAt) was ever considered for a reminder.
      dueDate: { field: 'dueDate', type: 'date' },
    },
    sortable: {
      createdAt: 'createdAt',
      position: 'position',
      hierarchyId: 'hierarchyId',
      dueDate: 'dueDate',
    },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Task) {
    return taskResponse(row);
  }
  /**
   * Display names for an assignee list.
   *
   * `assigneeIds` and `assignedTo` are two views of the same list and mirror
   * each other, but `assignedToNames` has nothing to mirror from: a name is not
   * derivable from an id without a lookup, and only the server can do that. A
   * client that sent ids alone — Clone Project did exactly this, and so does any
   * direct API caller — produced a task that read as assigned to NOBODY on every
   * screen that renders the names, with no way to repair it except reassigning
   * by hand.
   *
   * Resolved from the user table rather than trusted from the request, so the
   * denormalised copy cannot disagree with the account it names. Ids with no
   * matching user are dropped rather than rendered as a blank chip.
   */
  private async namesFor(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u.name || u.email]));
    return ids.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
  }

  /**
   * Every assignee must be a member of the workspace the task lives in.
   *
   * Unvalidated, `assigneeIds` accepted arbitrary strings: a task stored
   * `["definitely-not-a-user"]` with a 201, and the board then rendered a chip
   * for somebody who does not exist — or, worse, silently assigned work to an
   * id belonging to another tenant's account.
   */
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
    const assignees = dto.assigneeIds ?? dto.assignedTo ?? [];
    // Same reasoning one field over: a client that names an assigner by id only
    // left every "Assigned by" line blank.
    const [assignedByName] = dto.assignedBy ? await this.namesFor([dto.assignedBy]) : [];
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
    // A brand-new task cannot have been reviewed, so it cannot be done. PATCH
    // has enforced the REVIEW gate all along (patchStatus), but create accepted
    // `status: 'DONE'` outright and stamped completedAt — the New Task dialog
    // even offered it. That is the same rule, skipped by the other door.
    if (dto.status === 'DONE') {
      throw new BadRequestException(
        'A new task cannot start out done — it has to pass through Review first.',
      );
    }
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      hierarchyId: dto.hierarchyId,
      sprintId: dto.sprintId ?? '',
      epicId: dto.epicId ?? '',
      functionalRequirementId: dto.functionalRequirementId ?? '',
      parentTaskId: dto.parentTaskId ?? '',
      title: dto.title,
      description: dto.description ?? '',
      status: dto.status ?? 'BACKLOG',
      priority: dto.priority ?? 'MEDIUM',
      completedAt: dto.status === 'DONE' ? new Date() : null,
      // assigneeIds and assignedTo are two views of the same list. A client that
      // sends only one used to leave the other empty, so whichever view the
      // reader trusted showed nobody assigned — mirror them here instead.
      assigneeIds: assignees,
      assignedBy: dto.assignedBy ?? '',
      assignedByName: dto.assignedByName || assignedByName,
      assignedTo: assignees,
      // Resolved from the ids when the caller did not send them — see namesFor.
      assignedToNames: dto.assignedToNames ?? (await this.namesFor(assignees)),
      watcherIds: dto.watcherIds ?? [],
      createdById: user.id,
      createdByName: user.name ?? '',
      dueDate: toDate(dto.dueDate, 'Due date'),
      estimatedHours: dto.estimatedHours ?? null,
      actualHours: dto.actualHours ?? null,
      labels: dto.labels ?? [],
      attachments: dto.attachments ?? [],
      customFields: dto.customFields ?? {},
      position: dto.position ?? 0,
      // Always empty: dependencies are two-sided and are written only by
      // writeDependency (see CreateTaskDto).
      blockedBy: [],
      blocks: [],
    });
  }
  async patch(user: User, id: string, dto: UpdateTaskDto) {
    assertNoSelfReference(id, dto);
    const data: Record<string, unknown> = {};
    // blockedBy/blocks are deliberately NOT copyable here: each is only half of
    // an edge, so a PATCH of one side alone desynchronises the graph and skips
    // the cycle check. Use the dependency endpoints, which write both sides.
    const copy = [
      'hierarchyId', 'title', 'sprintId', 'epicId', 'functionalRequirementId', 'parentTaskId',
      'description', 'status', 'priority', 'assigneeIds', 'assignedBy', 'assignedByName',
      'assignedTo', 'assignedToNames', 'watcherIds', 'estimatedHours', 'actualHours', 'labels',
      'attachments', 'customFields', 'position',
    ] as const;
    for (const k of copy) if (dto[k] !== undefined) data[k] = dto[k];
    if (dto.dueDate !== undefined) data.dueDate = toDate(dto.dueDate, 'Due date');
    // Reassigning by id alone must not blank the names, and the two id views
    // must not drift apart — the same rules create applies.
    if (dto.parentTaskId) await this.assertNoParentCycle(id, dto.parentTaskId);
    const nextAssignees = dto.assigneeIds ?? dto.assignedTo;
    if (nextAssignees !== undefined) {
      data.assigneeIds = nextAssignees;
      data.assignedTo = nextAssignees;
      if (dto.assignedToNames === undefined) data.assignedToNames = await this.namesFor(nextAssignees);
    }
    if (dto.assignedBy !== undefined && dto.assignedByName === undefined) {
      const [resolved] = dto.assignedBy ? await this.namesFor([dto.assignedBy]) : [];
      data.assignedByName = resolved ?? '';
    }
    // Keep the self-reference rejection synchronous — only the status path needs
    // to read the stored row first.
    if (dto.status === undefined) return this.update(user, id, data);
    return this.patchStatus(user, id, dto.status, data);
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
    id: string,
    status: string,
    data: Record<string, unknown>,
  ) {
    const current = await this.findScoped(user, id);
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
      data.completedAt = null;
    }
    return this.update(user, id, data);
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
      this.findScoped(user, targetTaskId),
    ]);
    if (task.workspaceId !== target.workspaceId) {
      throw new BadRequestException('Tasks in different workspaces cannot depend on each other');
    }
    // A dependency edge changes two existing tasks, so it is an update.
    await this.access.assertPermission(user, task.workspaceId, this.updatePermission);

    // Normalise to one direction: `blocked` waits on `blocker`.
    const [blocked, blocker] = type === 'blockedBy' ? [task, target] : [target, task];
    if (mode === 'add') {
      await this.assertNoCycle(task.workspaceId, blocked.id, blocker.id);
    }

    const nextBlockedBy =
      mode === 'add'
        ? withId(idList(blocked.blockedBy), blocker.id)
        : idList(blocked.blockedBy).filter((x) => x !== blocker.id);
    const nextBlocks =
      mode === 'add'
        ? withId(idList(blocker.blocks), blocked.id)
        : idList(blocker.blocks).filter((x) => x !== blocked.id);

    const rows = await this.prisma.$transaction([
      this.prisma.task.update({ where: { id: blocked.id }, data: { blockedBy: nextBlockedBy } }),
      this.prisma.task.update({ where: { id: blocker.id }, data: { blocks: nextBlocks } }),
    ]);
    const addressed = rows.find((r) => r.id === id) ?? rows[0];
    return this.map(addressed as Task);
  }

  /**
   * Reject `blocked` → `blocker` if `blocker` already waits (transitively) on
   * `blocked`. Breadth-first over the workspace's `blockedBy` graph: a visited
   * set makes it terminate on an already-cyclic graph, and NODE_BUDGET bounds
   * the work so one request can never walk an unbounded number of rows.
   * Scope is the workspace, so cross-PROJECT edges are checked too — the
   * dependency UI offers them and labels them "Cross-project".
   *
   * Known residual: the walk reads before the write transaction opens, so two
   * clients adding the two halves of the same cycle at the same instant can both
   * pass. Closing that needs SERIALIZABLE plus a retry loop, whose serialization
   * failures would be a worse everyday regression than the race it prevents.
   */
  private async assertNoCycle(
    workspaceId: string,
    blockedId: string,
    blockerId: string,
  ): Promise<void> {
    const NODE_BUDGET = 1000;
    const visited = new Set<string>([blockerId]);
    let frontier = [blockerId];
    while (frontier.length > 0) {
      const rows = await this.prisma.task.findMany({
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
}

/** JSON id column → string[] (the column is `Json`, so it can hold anything). */
function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function withId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
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

@Injectable()
export class LabelsService extends ScopedCrudService<Label, ReturnType<typeof labelResponse>> {
  protected readonly model = 'label';
  protected readonly auditEntity = 'label';
  protected readonly writePermission: PermissionKey = Permission.TaskWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      name: { field: 'name' },
    },
    sortable: { createdAt: 'createdAt', name: 'name' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Label) {
    return labelResponse(row);
  }
  create(user: User, dto: CreateLabelDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId ?? null,
      name: dto.name,
      color: dto.color,
      description: dto.description ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateLabelDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.projectId !== undefined) data.projectId = dto.projectId;
    if (dto.description !== undefined) data.description = dto.description;
    return this.update(user, id, data);
  }
}
