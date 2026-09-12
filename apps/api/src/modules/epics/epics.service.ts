import { Injectable } from '@nestjs/common';
import { assertDateRangeOrdered, type ListQuerySpec, toDate } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Epic, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { assertLinkInProject, assertProjectInWorkspace } from '../workspaces/workspace-refs';
import type { CreateEpicDto, UpdateEpicDto } from './dto';
import { epicResponse } from './mappers';

/** The two columns an epic's rollup owns; every other field is human-authored. */
const ROLLUP_FIELDS: ReadonlySet<string> = new Set(['progress', 'status']);

@Injectable()
export class EpicsService extends ScopedCrudService<Epic, ReturnType<typeof epicResponse>> {
  protected readonly model = 'epic';
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
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
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
    await assertLinkInProject(
      this.prisma, 'clientRequirement', 'Client requirement', dto.requirementId, dto.projectId,
    );
    const startDate = toDate(dto.startDate, 'Start date');
    const endDate = toDate(dto.endDate, 'End date');
    assertDateRangeOrdered(startDate, endDate, { start: 'Start date', end: 'Target end date' });
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      requirementId: dto.requirementId ?? '',
      hierarchyId: dto.hierarchyId,
      name: dto.name,
      description: dto.description ?? '',
      color: dto.color ?? '',
      startDate,
      endDate,
      status: dto.status ?? 'TODO',
      progress: dto.progress ?? 0,
      assignedTeam: dto.assignedTeam ?? '',
      createdById: user.id,
      createdByName: user.name ?? '',
    });
  }
  async patch(user: User, id: string, dto: UpdateEpicDto) {
    const data: Record<string, unknown> = {};
    if (dto.hierarchyId !== undefined) data.hierarchyId = dto.hierarchyId;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.requirementId !== undefined) data.requirementId = dto.requirementId;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.startDate !== undefined) data.startDate = toDate(dto.startDate, 'Start date');
    if (dto.endDate !== undefined) data.endDate = toDate(dto.endDate, 'End date');
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.progress !== undefined) data.progress = dto.progress;
    if (dto.assignedTeam !== undefined) data.assignedTeam = dto.assignedTeam;
    // Validate against the pair the row will END UP with, so moving one end
    // alone cannot produce a range the create path would have refused. Reads
    // the stored epic only when a date is actually being changed.
    if (data.startDate !== undefined || data.endDate !== undefined) {
      const row = await this.findScoped(user, id);
      assertDateRangeOrdered(
        (data.startDate as Date | null | undefined) ?? row.startDate,
        (data.endDate as Date | null | undefined) ?? row.endDate,
        { start: 'Start date', end: 'Target end date' },
      );
    }
    const fields = Object.keys(data);
    if (fields.length > 0 && fields.every((f) => ROLLUP_FIELDS.has(f))) {
      return this.patchRollup(user, id, data);
    }
    return this.update(user, id, data);
  }

  /** The epic's rollup as its task set actually stands. */
  private async deriveRollup(id: string) {
    const [total, done] = await Promise.all([
      this.prisma.task.count({ where: { epicId: id } }),
      this.prisma.task.count({ where: { epicId: id, status: 'DONE' } }),
    ]);
    return {
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
      // Count equality, NOT `progress === 100`: Math.round reports 100% at
      // 999 of 1000 done. This is the same rule as deriveEpicMetrics on the
      // client, which is what every epic surface renders.
      status: total > 0 && done === total ? 'DONE' : done > 0 ? 'IN_PROGRESS' : 'TODO',
    };
  }

  /**
   * A patch that touches ONLY `progress`/`status` is the task rollup, not an
   * edit: the client re-derives both after every task create, status change and
   * delete, and no screen offers them as inputs (the edit dialog deliberately
   * omits them). It still required `planning:write`, which the four delivery
   * roles do not hold — they hold `task:update` — so every rollup a developer's
   * own task edit triggered came back 403, was swallowed client-side, and left
   * the epic frozen at whatever a manager last saw (a card reading
   * "In Progress / 50%" over a task set that was really 0 of 2 done).
   *
   * So a rollup-shaped patch is additionally allowed to anyone holding
   * `task:update` — the permission that let them change the task that triggered
   * it. For THAT caller the submitted numbers are ignored and both columns are
   * recomputed from the tasks, so `task:update` cannot be used to declare an
   * epic finished; the response carries the derived values.
   *
   * A caller who holds `planning:write` keeps the numbers it sent, PATCH and
   * PUT alike. An earlier revision derived for everyone, which quietly turned
   * `PATCH {status:'DONE'}` into a 200 that changed nothing — an API that
   * discards its input is a worse bug than the one it was fixing. A `status`
   * sent ALONE is therefore still stored verbatim: nothing about a task set
   * means "a human decided this", so that one is a decision, not a rollup.
   *
   * What that caller does NOT get to choose is the `status` that comes attached
   * to a `progress`. `progress` is the measured half of the pair and `status`
   * the derived half, so whenever a progress is present the status is
   * recomputed here from the task counts:
   *
   *  - a `progress` with no `status` used to leave `status` on DONE and strand
   *    epics reading "Done, 0%, 0 / 0 tasks";
   *  - a `progress` WITH a `status` is how "Done at 100% with a task still
   *    open" got stored. Math.round(240/241 * 100) is 100, and a client that
   *    read DONE off that rounded number sent {progress:100, status:'DONE'} for
   *    an epic that deriveRollup, deriveEpicMetrics and every epic card on
   *    screen all call IN_PROGRESS. The client no longer derives from the
   *    percentage (use-task.ts), but the invariant belongs here too — this is
   *    the only place that can count the tasks authoritatively.
   */
  private async patchRollup(user: User, id: string, submitted: Record<string, unknown>) {
    const row = await this.findScoped(user, id);
    const workspaceId = this.workspaceOf(row);
    const privileged = await this.access.can(user, workspaceId, Permission.PlanningWrite);
    if (!privileged) {
      await this.access.assertPermission(user, workspaceId, Permission.TaskUpdate);
    }

    let data: Record<string, unknown>;
    if (!privileged) {
      data = await this.deriveRollup(id);
    } else if (submitted.progress !== undefined) {
      // Progress present => this is the task rollup, whatever status came with
      // it. Count equality decides DONE; a rounded percentage never does.
      data = { ...submitted, status: (await this.deriveRollup(id)).status };
    } else {
      data = submitted;
    }

    const updated = (await this.delegate.update({ where: { id }, data })) as Epic;
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
