import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { todayIn, workScheduleOf } from '@strata/config';
import { TaskEvents } from '@strata/shared';
import { type PrismaService, refreshDeliveryRollups } from '@strata/prisma';
import type { FunctionalRequirement, User } from '@prisma/client';
import { writeAuditRow } from '../activity/audit-writer';
import { createWithFreeHierarchyId } from '../generation/hierarchy-id.service';
import { emitDomainEvent } from '../workspaces/domain-event';

/** What the mover needs to know about the sprint a requirement landed in. */
interface SprintFacts {
  status: string;
  endDate: Date | null;
}

/**
 * The instant a calendar day begins in a timezone.
 *
 * `day` is a date-only value as sprints store it — the UTC midnight of the day
 * it names — so its UTC parts are the day. The zone's offset is read twice:
 * across a daylight-saving change its offset at UTC midnight is not always its
 * offset at its own midnight. A zone that springs forward AT midnight has no
 * 00:00 that day, and one that falls back at midnight reads 23:00 of the day
 * before at the first guess; of the two readings, the earliest that falls on
 * the day is when it begins.
 */
export function startOfDayIn(day: Date, timeZone: string): Date {
  const target = day.toISOString().slice(0, 10);
  const midnightUtc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const first = midnightUtc - offsetAt(midnightUtc, timeZone);
  const second = midnightUtc - offsetAt(first, timeZone);
  const onTheDay = [first, second].filter((at) => todayIn(timeZone, new Date(at)) === target);
  return new Date(onTheDay.length > 0 ? Math.min(...onTheDay) : second);
}

/** How far a zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const read = (type: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return wall - instant;
}

/**
 * Where a requirement goes, its tasks go.
 *
 * A sprint is planned by requirement and a task belongs to one, so moving a
 * requirement into a sprint, out of one, or under another epic is a statement
 * about its tasks as well. The browser used to carry that out — list the
 * tasks, PATCH each, create one if there were none, then re-save the parents'
 * totals — as a string of separate requests after the requirement had already
 * been saved. Any other caller moved the requirement and left the tasks where
 * they were; a tab closed part-way did the same; and each of those PATCHes ran
 * with the permissions of whoever clicked, so the outcome depended on who they
 * were. It is one consequence of one save now, carried out here.
 *
 * A plain class, built by the service that owns the requirement: this is that
 * service's own write, not something another module should be reaching for.
 */
export class RequirementTasks {
  private readonly logger = new Logger('RequirementTasks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * The requirement changed sprint. `requirement` is the row as saved.
   *
   * Out of a sprint: its OPEN tasks that were in the sprint it left leave with
   * it — only those. One somebody moved elsewhere by hand is not dragged out of
   * where they put it, and a finished one stays where it was delivered: taking
   * it out erased done work from the sprint's velocity and from what it
   * recorded when it closed.
   *
   * Into a sprint: its OPEN tasks join. A finished task was delivered in the
   * sprint it is in, and carrying it along would rewrite where finished work
   * was done and pad the new sprint with work nobody will do in it.
   */
  async followSprint(
    actor: User,
    requirement: FunctionalRequirement,
    priorSprintId: string,
  ): Promise<void> {
    const sprintId = requirement.sprintId || '';
    const mine = { functionalRequirementId: requirement.id };

    if (!sprintId) {
      if (!priorSprintId) return;
      const leaving = await this.idsOf({
        ...mine,
        sprintId: priorSprintId,
        status: { not: 'DONE' },
      });
      await this.moveAll([{ ids: leaving, data: { sprintId: '' } }]);
      await this.announce(leaving);
      return;
    }

    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { status: true, endDate: true },
    });
    if (!sprint) return;
    const dueDate = sprint.endDate
      ? await this.dueOn(sprint.endDate, requirement.workspaceId)
      : null;

    if ((await this.prisma.task.count({ where: mine })) === 0) {
      await this.createFirstTask(actor, requirement, sprint, dueDate);
      return;
    }

    const open = await this.idsOf({ ...mine, status: { not: 'DONE' } });
    // One transaction: half a move (in the sprint, still in Backlog) is a board
    // nobody can explain.
    await this.moveAll([
      { ids: open, data: { sprintId } },
      // The sprint's end is a deadline only for a task that had none. It used
      // to be written over every task, every time the requirement was planned,
      // so a date somebody had agreed with a client was replaced without a word.
      ...(dueDate ? [{ ids: open, data: { dueDate }, only: { dueDate: null } }] : []),
      // A running sprint's board has no Backlog column — the same step sprint
      // start takes for the tasks that are already in it.
      ...(sprint.status === 'ACTIVE'
        ? [{ ids: open, data: { status: 'TODO' }, only: { status: 'BACKLOG' } }]
        : []),
    ]);
    await this.announce(open);
  }

  /**
   * The requirement moved under another epic: so do its tasks — the ones that
   * were under the epic it left. A task filed under a third epic on purpose
   * stays there.
   */
  async followEpic(requirement: FunctionalRequirement, priorEpicId: string): Promise<void> {
    const epicId = requirement.epicId || '';
    const moving = await this.idsOf({
      functionalRequirementId: requirement.id,
      epicId: priorEpicId,
    });
    await this.moveAll([{ ids: moving, data: { epicId } }]);
    await this.announce(moving);
    // Both epics' totals changed: one lost these tasks, the other gained them.
    await this.refresh(requirement.id, priorEpicId, epicId);
  }

  /**
   * The people on the requirement changed. `before` is who was on it.
   *
   * Both screens that assign a requirement used to follow the save by writing
   * the requirement's whole list over EVERY task under it. A requirement with
   * three tasks, each given to the person doing it, came out with all three
   * assigned to everybody the moment one more name was added.
   *
   * What a change to the requirement means for a task depends on the task:
   *
   *  - one that had exactly the requirement's people was simply following it,
   *    and goes on following: it gets the new list;
   *  - one somebody assigned differently keeps the people it was given — less
   *    anyone who has just been taken off the requirement altogether.
   *
   * Finished tasks are left alone: who did the work is a matter of record.
   */
  /**
   * Returns, for each person taken off any of the open tasks, how many — the
   * service tells them; a task losing its assignee said nothing to anybody.
   */
  async followAssignees(
    actor: User,
    requirement: FunctionalRequirement,
    before: readonly string[],
  ): Promise<Map<string, number>> {
    const takenOff = new Map<string, number>();
    const open = await this.prisma.task.findMany({
      where: { functionalRequirementId: requirement.id, status: { not: 'DONE' } },
      select: { id: true, assigneeIds: true },
    });
    if (open.length === 0) return takenOff;

    const listed = Array.isArray(requirement.assigneeIds) ? (requirement.assigneeIds as string[]) : [];
    const removed = new Set(before.filter((id) => !listed.includes(id)));
    const after = (await this.stillMembers(requirement.workspaceId, listed)).map((a) => a.id);
    const followed = (held: readonly string[]): boolean =>
      held.length === before.length && held.every((id) => before.includes(id));

    const changes = open
      .map((task) => {
        const held = Array.isArray(task.assigneeIds) ? (task.assigneeIds as string[]) : [];
        const next = followed(held) ? after : held.filter((id) => !removed.has(id));
        const same = next.length === held.length && next.every((id, i) => id === held[i]);
        for (const id of held) if (!next.includes(id)) takenOff.set(id, (takenOff.get(id) ?? 0) + 1);
        return same ? null : { id: task.id, next };
      })
      .filter((change): change is { id: string; next: string[] } => change !== null);
    if (changes.length === 0) return takenOff;

    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(changes.flatMap((change) => change.next))] } },
      select: { id: true, name: true, email: true },
    });
    const nameOf = new Map(people.map((u) => [u.id, u.name || u.email]));
    for (const { id, next } of changes) {
      // `update`, one row at a time: each task ends up with its own list, and
      // `update` is the write the realtime hook sees.
      await this.prisma.task.update({
        where: { id },
        data: {
          assigneeIds: next,
          assigneeNames: next.map((userId) => nameOf.get(userId) ?? ''),
          // Handed on by whoever changed the requirement's people.
          assignedBy: next.length > 0 ? actor.id : '',
          assignedByName: next.length > 0 ? actor.name || actor.email : '',
          version: { increment: 1 },
        },
      });
    }
    return takenOff;
  }

  /**
   * A requirement planned with no tasks under it becomes one task, so there is
   * something to put on the board and to assign: the requirement itself, as a
   * single piece of work, until somebody breaks it down further.
   */
  private async createFirstTask(
    actor: User,
    requirement: FunctionalRequirement,
    sprint: SprintFacts,
    dueDate: Date | null,
  ): Promise<void> {
    const assignees = await this.stillMembers(
      requirement.workspaceId,
      Array.isArray(requirement.assigneeIds) ? (requirement.assigneeIds as string[]) : [],
    );
    const code = requirement.title.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TSK';
    const actorName = actor.name || actor.email || '';
    // Past the last card on the board, as TasksService.create places a new task.
    // The task COUNT was used here: once cards are dropped between neighbours
    // (fractional positions) or past the end, positions run past the count, and a
    // task numbered by it landed in the middle of its column.
    const { _max } = await this.prisma.task.aggregate({
      where: { projectId: requirement.projectId },
      _max: { position: true },
    });
    const position = _max.position === null ? 0 : Math.floor(_max.position) + 1;

    const task = await createWithFreeHierarchyId(
      `${requirement.hierarchyId}-${code}-01`,
      async (hierarchyId) =>
        (await this.prisma.task.findFirst({
          where: { projectId: requirement.projectId, hierarchyId },
          select: { id: true },
        })) !== null,
      (hierarchyId) =>
        this.prisma.task.create({
          data: {
            id: generateId(),
            workspaceId: requirement.workspaceId,
            projectId: requirement.projectId,
            hierarchyId,
            sprintId: requirement.sprintId || '',
            epicId: requirement.epicId || '',
            functionalRequirementId: requirement.id,
            parentTaskId: '',
            title: requirement.title,
            description: requirement.description || '',
            status: sprint.status === 'ACTIVE' ? 'TODO' : 'BACKLOG',
            priority: requirement.priority || 'MEDIUM',
            assigneeIds: assignees.map((a) => a.id),
            assigneeNames: assignees.map((a) => a.name),
            // Whoever planned it handed the work out, not whoever first wrote
            // the requirement down.
            assignedBy: assignees.length > 0 ? actor.id : '',
            assignedByName: assignees.length > 0 ? actorName : '',
            createdById: actor.id,
            createdByName: actorName,
            dueDate,
            position,
          },
        }),
    );

    await writeAuditRow(this.prisma, {
      workspaceId: task.workspaceId,
      userId: actor.id,
      entity: 'task',
      action: 'created',
      entityId: task.id,
      row: task as unknown as Record<string, unknown>,
      extraMetadata: { fromRequirement: requirement.id },
    });
    if (assignees.length > 0) {
      emitDomainEvent(this.events, TaskEvents.Assigned, task.workspaceId, {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        title: task.title,
        hierarchyId: task.hierarchyId,
        actorId: actor.id,
        actorName,
        assigneeIds: assignees.map((a) => a.id),
      });
    }
    // The requirement has a task now, and so does its epic.
    await this.refresh(requirement.id, requirement.epicId);
  }

  /**
   * The sprint's last day, as a task's due date.
   *
   * A due date names a DAY, and that day is read in the workspace's business
   * timezone. The sprint's end is stored as the UTC midnight of its day, and
   * written onto tasks as it was, it fell on the PREVIOUS day for every zone
   * west of UTC — a sprint ending Friday made its tasks due Thursday. The
   * instant the day begins in the business timezone reads as that day under
   * the rule, and is exactly what the task form saves when somebody there
   * picks the same day (the date picker stores local midnight).
   */
  private async dueOn(sprintEnd: Date, workspaceId: string): Promise<Date> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    return startOfDayIn(sprintEnd, workScheduleOf(workspace?.settings).timeZone);
  }

  /** The requirement's assignees who are still here, with the names to show. */
  private async stillMembers(
    workspaceId: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; name: string }>> {
    if (ids.length === 0) return [];
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: [...new Set(ids)] }, status: 'ACTIVE' },
      select: { userId: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u.name || u.email]));
    // In the order the requirement lists them, not the order the database
    // happened to return them.
    return [...new Set(ids)]
      .filter((id) => byId.has(id))
      .map((id) => ({ id, name: byId.get(id) as string }));
  }

  private async idsOf(where: Record<string, unknown>): Promise<string[]> {
    const rows = await this.prisma.task.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }

  /**
   * Conditional writes over sets of tasks, all or none; each counts as an edit
   * to the tasks it changes.
   */
  private async moveAll(
    moves: ReadonlyArray<{
      ids: readonly string[];
      data: Record<string, unknown>;
      only?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    const writes = moves
      .filter((move) => move.ids.length > 0)
      .map((move) =>
        this.prisma.task.updateMany({
          where: { id: { in: [...move.ids] }, ...(move.only ?? {}) },
          data: { ...move.data, version: { increment: 1 } },
        }),
      );
    if (writes.length > 0) await this.prisma.$transaction(writes);
  }

  /** `updateMany` is invisible to the realtime hook; hand it the rows. */
  private async announce(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.prisma.task.findMany({ where: { id: { in: [...ids] } } });
    for (const row of rows) this.prisma.announceWrite?.('Task', 'update', row);
  }

  /** Bookkeeping about a move already made: a failure is logged, never the move's. */
  private async refresh(requirementId: string, ...epicIds: Array<string | null>): Promise<void> {
    await refreshDeliveryRollups(
      this.prisma,
      { functionalRequirementIds: [requirementId], epicIds },
      (error, kind, id) =>
        this.logger.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`),
    );
  }
}
