import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { todayIn, workScheduleOf } from '@strata/config';
import {
  CLIENT_REQUIREMENT_DERIVED_STATUSES,
  PrismaService,
  refreshDeliveryRollups,
} from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { writeAuditRow } from '../activity/audit-writer';
import { tellPeople } from '../notifications/notice';
import { dayIn, dayMarker, daysBetween, markerDay, shiftInstant, shiftMarker } from './clone-dates';
import type { CloneProjectDto } from './dto';
import { projectResponse } from './mappers';

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * The three-letter code the create form derives from a name (lib/utils
 * generateProjectCode), so a copy's code reads like any other project's.
 */
export function projectCodeFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return 'PRJ';
  let code: string;
  if (words.length === 1) {
    code = words[0].substring(0, 3).toUpperCase();
    while (code.length < 3) code += code[code.length - 1] || 'X';
  } else if (words.length === 2) {
    code = (words[0].substring(0, 2) + words[1].substring(0, 1)).toUpperCase();
    if (code.length < 3) code += words[0][0]?.toUpperCase() || 'X';
  } else {
    code = words
      .slice(0, 3)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }
  while (code.length < 3) code += 'X';
  return code.substring(0, 3);
}

/** A unique-key clash on the project code: somebody took it between the probe and the write. */
export function isShortCodeConflict(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { target?: unknown } };
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  const columns = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return columns.includes('short_code') || columns.includes('shortCode');
}

/**
 * Copy a project — in one transaction, on the server.
 *
 * The copy used to be a loop in the browser: one request per sprint,
 * requirement, epic and task, a few thousand for a real project, with nothing
 * holding them together. A failure part-way left half a project behind. And
 * every one of those creates went through its ordinary route with that route's
 * side effects: each copied requirement and epic told the whole workspace, and
 * each assigned task notified and mailed its assignee — one copy in a workspace
 * of fifty sent hundreds of notices.
 *
 * Here the copy commits whole or not at all; every id is minted up front, so a
 * child is written already pointing at its copied parent; and afterwards each
 * person with work in the copy is told once.
 */
@Injectable()
export class ProjectCloneService {
  private readonly logger = new Logger('ProjectClone');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async clone(user: User, sourceId: string, dto: CloneProjectDto) {
    // Scoped, like every other project read: a project in somebody else's
    // workspace is "not found", never "forbidden".
    const scope = await this.access.scopeWhere(user);
    const source = await this.prisma.project.findFirst({ where: { AND: [scope, { id: sourceId }] } });
    if (!source) throw new NotFoundException('Not found.');
    const workspaceId = source.workspaceId;
    // Each part of the copy under the permission its own create asks for.
    await this.access.assertPermission(user, workspaceId, Permission.ProjectCreate);
    if (dto.includeSprints) await this.access.assertPermission(user, workspaceId, Permission.PlanningWrite);
    if (dto.includeTasks) {
      await this.access.assertPermission(user, workspaceId, Permission.RequirementWrite);
      await this.access.assertPermission(user, workspaceId, Permission.PlanningWrite);
      await this.access.assertPermission(user, workspaceId, Permission.TaskCreate);
    }

    // Assignments carry over for the people who are still here; work for
    // somebody who has left is copied unassigned (a create would refuse them).
    const active = new Set(
      (
        await this.prisma.workspaceMember.findMany({
          where: { workspaceId, status: 'ACTIVE' },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    let assignmentsDropped = 0;
    const stillHere = (people: unknown, names: unknown) => {
      const list = strings(people);
      const nameList = strings(names);
      const keep = list.map((id) => active.has(id));
      assignmentsDropped += keep.filter((k) => !k).length;
      return {
        ids: list.filter((_, i) => keep[i]),
        // Index-aligned with the ids; a list that is not is dropped, not misattributed.
        names: nameList.length === list.length ? nameList.filter((_, i) => keep[i]) : [],
      };
    };

    const [sprints, requirements, epics, frs, tasks] = await Promise.all([
      dto.includeSprints ? this.prisma.sprint.findMany({ where: { projectId: source.id } }) : [],
      dto.includeTasks ? this.prisma.clientRequirement.findMany({ where: { projectId: source.id } }) : [],
      dto.includeTasks ? this.prisma.epic.findMany({ where: { projectId: source.id } }) : [],
      dto.includeTasks ? this.prisma.functionalRequirement.findMany({ where: { projectId: source.id } }) : [],
      dto.includeTasks ? this.prisma.task.findMany({ where: { projectId: source.id } }) : [],
    ]);
    // Every new id first, so a child is written pointing at its copied parent —
    // a sibling parent (a sub-requirement, a sub-task) included.
    const newIds = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, generateId()]));
    const sprintIds = newIds(sprints);
    const requirementIds = newIds(requirements);
    const epicIds = newIds(epics);
    const frIds = newIds(frs);
    const taskIds = newIds(tasks);
    const remap = (map: Map<string, string>, id: string | null | undefined) => (id && map.get(id)) || '';
    const by = { createdById: user.id, createdByName: user.name ?? '' };

    // The copy starts on its own day, and the whole plan moves with it — see
    // clone-dates. "Today" is the workspace's; the UTC date this used to take
    // was yesterday in India until half past five in the morning.
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const { timeZone } = workScheduleOf(workspace?.settings);
    const startDay = dto.startDate ? dto.startDate.slice(0, 10) : todayIn(timeZone);
    // What the plan is measured from: the source's start, or — for a project
    // that never had one — the earliest date anything in the copy carries.
    const dated = [
      ...(source.endDate ? [markerDay(source.endDate)] : []),
      ...sprints.flatMap((s) => [markerDay(s.startDate), markerDay(s.endDate)]),
      ...epics.flatMap((e) => [e.startDate, e.endDate].filter((d): d is Date => d !== null).map(markerDay)),
      ...tasks.flatMap((t) => (t.dueDate ? [dayIn(t.dueDate, timeZone)] : [])),
    ].sort();
    const anchor = source.startDate ? markerDay(source.startDate) : dated[0];
    const moved = anchor ? daysBetween(anchor, startDay) : 0;
    const day = (marker: Date | null): Date | null => (marker ? shiftMarker(marker, moved) : null);

    // The code is probed, then written; a project created in between with the
    // same code loses this race at the unique key, and the copy tries the next.
    for (let attempt = 0; ; attempt += 1) {
      const shortCode = await freeProjectCode(this.prisma, workspaceId, dto.name);
      const rehome = (hierarchyId: string): string =>
        source.shortCode ? hierarchyId.replace(source.shortCode, shortCode) : hierarchyId;
      assignmentsDropped = 0;
      const projectRow = {
        id: generateId(),
        workspaceId,
        name: dto.name,
        shortCode,
        description: source.description || `Copied from ${source.name}`,
        clientName: source.clientName,
        // A copy is a plan, whatever its source had become — an archived source
        // included: copying is how its work is picked up again.
        status: 'PLANNING',
        startDate: dayMarker(startDay),
        endDate: day(source.endDate),
        ownerId: user.id,
        ...by,
      };
      const projectId = projectRow.id;
      const sprintRows = sprints.map((s) => ({
        id: sprintIds.get(s.id)!,
        workspaceId,
        projectId,
        name: s.name,
        goal: s.goal,
        // A copy is a plan: none of its sprints has started, let alone ended.
        status: 'PLANNING',
        startDate: shiftMarker(s.startDate, moved),
        endDate: shiftMarker(s.endDate, moved),
        ...by,
      }));
      const requirementRows = requirements.map((r) => ({
        id: requirementIds.get(r.id)!,
        workspaceId,
        projectId,
        title: r.title,
        description: r.description,
        clientName: r.clientName || source.clientName,
        priority: r.priority,
        // Drafting, approving and archiving the request are people's decisions
        // and carry over. In Progress and Completed are what its work said, and
        // the copy's work has not started: back to Approved, where the roll-up
        // takes it from (a requirement with no work under it is never re-summed,
        // so a copied "Completed" stayed Completed).
        status: CLIENT_REQUIREMENT_DERIVED_STATUSES.includes(r.status) ? 'APPROVED' : r.status,
        ...by,
      }));
      // Epics and requirements start at To Do / Draft and 0%: their status and
      // progress are roll-ups of tasks that all start To Do.
      const epicRows = epics.map((e) => ({
        id: epicIds.get(e.id)!,
        workspaceId,
        projectId,
        requirementId: remap(requirementIds, e.requirementId),
        hierarchyId: rehome(e.hierarchyId),
        name: e.name,
        description: e.description,
        color: e.color,
        startDate: day(e.startDate),
        endDate: day(e.endDate),
        status: 'TODO',
        progress: 0,
        ...by,
      }));
      const frRows = frs.map((f) => {
        const people = stillHere(f.assigneeIds, f.assigneeNames);
        return {
          id: frIds.get(f.id)!,
          workspaceId,
          projectId,
          hierarchyId: rehome(f.hierarchyId),
          epicId: remap(epicIds, f.epicId),
          sprintId: remap(sprintIds, f.sprintId),
          clientRequirementId: remap(requirementIds, f.clientRequirementId),
          parentRequirementId: remap(frIds, f.parentRequirementId),
          title: f.title,
          description: f.description,
          type: f.type,
          complexity: f.complexity,
          priority: f.priority,
          status: 'DRAFT',
          progress: 0,
          assigneeIds: people.ids as Prisma.InputJsonValue,
          assigneeNames: people.names as Prisma.InputJsonValue,
          ...by,
        };
      });
      const taskRows = tasks.map((t) => {
        const people = stillHere(t.assigneeIds, t.assigneeNames);
        return {
          id: taskIds.get(t.id)!,
          workspaceId,
          projectId,
          hierarchyId: rehome(t.hierarchyId),
          sprintId: remap(sprintIds, t.sprintId),
          epicId: remap(epicIds, t.epicId),
          functionalRequirementId: remap(frIds, t.functionalRequirementId),
          parentTaskId: remap(taskIds, t.parentTaskId),
          title: t.title,
          description: t.description,
          status: 'TODO',
          priority: t.priority,
          assigneeIds: people.ids as Prisma.InputJsonValue,
          assigneeNames: people.names as Prisma.InputJsonValue,
          // Whoever hands work out is whoever files it with people on it (the
          // create rule) — here, the person making the copy, who is also who
          // the assignees are told it came from.
          assignedBy: people.ids.length > 0 ? user.id : '',
          assignedByName: people.ids.length > 0 ? user.name || user.email : '',
          dueDate: t.dueDate ? shiftInstant(t.dueDate, moved, timeZone) : null,
          estimatedHours: t.estimatedHours,
          labels: (Array.isArray(t.labels) ? t.labels : []) as Prisma.InputJsonValue,
          position: t.position,
          // Dependencies point at tasks of the source; a copy starts without them.
          blockedBy: [] as Prisma.InputJsonValue,
          blocks: [] as Prisma.InputJsonValue,
          ...by,
        };
      });

      try {
        // createMany throughout, the project included: the write hook announces
        // single-row writes as they happen, which inside a transaction is before
        // the commit. Everything is announced below, once it is all there.
        await this.prisma.$transaction(
          async (tx) => {
            await tx.project.createMany({ data: [projectRow] });
            if (sprintRows.length) await tx.sprint.createMany({ data: sprintRows });
            if (requirementRows.length) await tx.clientRequirement.createMany({ data: requirementRows });
            if (epicRows.length) await tx.epic.createMany({ data: epicRows });
            if (frRows.length) await tx.functionalRequirement.createMany({ data: frRows });
            if (taskRows.length) await tx.task.createMany({ data: taskRows });
          },
          { timeout: 120_000 },
        );
      } catch (error) {
        if (isShortCodeConflict(error) && attempt < 2) continue;
        throw error;
      }

      const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      await this.afterCopy(user, source, project, {
        sprints: sprintRows,
        requirements: requirementRows,
        epics: epicRows,
        frs: frRows,
        tasks: taskRows,
      });
      return {
        ...projectResponse(project),
        copied: {
          sprints: sprintRows.length,
          clientRequirements: requirementRows.length,
          epics: epicRows.length,
          functionalRequirements: frRows.length,
          tasks: taskRows.length,
          assignmentsDropped,
          /** How many days later (or, negative, earlier) every copied date is than its source's. */
          daysMoved: moved,
        },
      };
    }
  }

  /** What follows a committed copy: roll-ups, the trail, the screens, and the people given work. */
  private async afterCopy(
    user: User,
    source: { id: string; name: string },
    project: Awaited<ReturnType<PrismaService['project']['findUniqueOrThrow']>>,
    rows: {
      sprints: { id: string }[];
      requirements: { id: string }[];
      epics: { id: string }[];
      frs: { id: string }[];
      tasks: { id: string; assigneeIds: unknown }[];
    },
  ): Promise<void> {
    await refreshDeliveryRollups(
      this.prisma,
      { functionalRequirementIds: rows.frs.map((r) => r.id), epicIds: rows.epics.map((r) => r.id) },
      (error, kind, id) => this.logger.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`),
    );
    await writeAuditRow(this.prisma, {
      workspaceId: project.workspaceId,
      userId: user.id,
      entity: 'project',
      action: 'created',
      entityId: project.id,
      row: project as unknown as Record<string, unknown>,
      extraMetadata: { copiedFrom: source.id, copiedFromName: source.name },
    });

    // The screens open on the workspace hear about the copy now that all of it
    // exists. Rows are re-read for the announcement so the frames carry what a
    // later read returns, roll-ups included.
    this.prisma.announceWrite?.('Project', 'create', project);
    const announce = async <T>(model: string, read: () => Promise<T[]>) => {
      for (const row of await read()) this.prisma.announceWrite?.(model, 'create', row);
    };
    const where = { projectId: project.id };
    if (rows.sprints.length) await announce('Sprint', () => this.prisma.sprint.findMany({ where }));
    if (rows.requirements.length) {
      await announce('ClientRequirement', () => this.prisma.clientRequirement.findMany({ where }));
    }
    if (rows.epics.length) await announce('Epic', () => this.prisma.epic.findMany({ where }));
    if (rows.frs.length) {
      await announce('FunctionalRequirement', () => this.prisma.functionalRequirement.findMany({ where }));
    }
    if (rows.tasks.length) await announce('Task', () => this.prisma.task.findMany({ where }));

    // One notice per person with work in the copy, instead of one per task.
    const workOf = new Map<string, number>();
    for (const task of rows.tasks) {
      for (const person of strings(task.assigneeIds)) workOf.set(person, (workOf.get(person) ?? 0) + 1);
    }
    const who = user.name || user.email;
    for (const [person, count] of workOf) {
      const tasks = count === 1 ? 'a task' : `${count} tasks`;
      tellPeople(this.events, {
        workspaceId: project.workspaceId,
        recipients: [person],
        actorId: user.id,
        type: 'TASK_ASSIGNED',
        title: `${count === 1 ? 'A task' : `${count} tasks`} for you in ${project.name}`,
        message: `${who} copied ${source.name} into a new project, ${project.name}, with ${tasks} assigned to you.`,
        // No single task to open: the bell takes the reader to this project's board.
        projectId: project.id,
        relatedEntityType: 'TASK',
        email: true,
      });
    }
  }
}

/**
 * A code for a project called `name` that no other project in the workspace
 * uses: the name's code, or the first free numbered variant ("MOA", "MOA2"…).
 * Probed, then written — a caller that loses the race at the unique key tries
 * again (isShortCodeConflict).
 */
export async function freeProjectCode(
  prisma: Pick<PrismaService, 'project'>,
  workspaceId: string,
  name: string,
): Promise<string> {
  const taken = new Set(
    (await prisma.project.findMany({ where: { workspaceId }, select: { shortCode: true } })).map(
      (p) => p.shortCode,
    ),
  );
  const base = projectCodeFor(name);
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    if (!taken.has(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  return `${base}${generateId().slice(0, 4).toUpperCase()}`;
}
