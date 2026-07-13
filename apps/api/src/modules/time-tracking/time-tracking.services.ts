import { Injectable, NotFoundException } from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { ActiveTimer, Prisma, TimeEntry, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type {
  CreateActiveTimerDto,
  CreateTimeEntryDto,
  UpdateActiveTimerDto,
  UpdateTimeEntryDto,
} from './dto';
import { activeTimerResponse, timeEntryResponse } from './mappers';

@Injectable()
export class TimeEntriesService extends ScopedCrudService<
  TimeEntry,
  ReturnType<typeof timeEntryResponse>
> {
  protected readonly model = 'timeEntry';
  protected readonly writePermission: PermissionKey = Permission.HrWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
      taskId: { field: 'taskId' },
      projectId: { field: 'projectId' },
      type: { field: 'type' },
    },
    sortable: { createdAt: 'createdAt', startTime: 'startTime' },
    defaultOrderBy: { startTime: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: TimeEntry) {
    return timeEntryResponse(row);
  }
  create(user: User, dto: CreateTimeEntryDto) {
    // userId/userName/userEmail/createdById are stamped from the caller.
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: user.id,
      userName: user.name || user.email,
      userEmail: user.email,
      createdById: user.id,
      createdByName: user.name ?? '',
      taskId: dto.taskId ?? '',
      taskTitle: dto.taskTitle ?? '',
      taskHierarchyId: dto.taskHierarchyId ?? '',
      projectId: dto.projectId ?? '',
      projectName: dto.projectName ?? '',
      description: dto.description ?? '',
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
      duration: dto.duration ?? 0,
      isBillable: dto.isBillable ?? false,
      billableRate: dto.billableRate ?? null,
      type: dto.type ?? 'MANUAL',
      status: 'PENDING',
      tags: dto.tags ?? [],
    });
  }
  patch(user: User, id: string, dto: UpdateTimeEntryDto) {
    const data: Record<string, unknown> = {};
    if (dto.startTime !== undefined) data.startTime = new Date(dto.startTime);
    if (dto.endTime !== undefined) data.endTime = new Date(dto.endTime);
    if (dto.duration !== undefined) data.duration = dto.duration;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isBillable !== undefined) data.isBillable = dto.isBillable;
    if (dto.billableRate !== undefined) data.billableRate = dto.billableRate;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.tags !== undefined) data.tags = dto.tags;
    return this.update(user, id, data);
  }
}

/**
 * ActiveTimer has no workspace column; it is tied to a single user
 * (`user_id` is UNIQUE). Every read/write is therefore scoped to the caller's
 * own timer — a user can only ever see or mutate their own, never another
 * user's by id.
 */
@Injectable()
export class ActiveTimersService {
  private readonly spec: ListQuerySpec = {
    filterable: { userId: { field: 'userId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof activeTimerResponse>>> {
    const parsed = parseListQuery(query, this.spec);
    // Force the caller's own scope — never trust a client-supplied userId filter.
    const where = { ...(parsed.where as Prisma.ActiveTimerWhereInput), userId: user.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activeTimer.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.ActiveTimerOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.activeTimer.count({ where }),
    ]);
    return paginate(items.map(activeTimerResponse), total, parsed.page, parsed.pageSize);
  }

  async retrieve(user: User, id: string) {
    const t = await this.prisma.activeTimer.findUnique({ where: { id } });
    if (!t || t.userId !== user.id) throw new NotFoundException('Not found.');
    return activeTimerResponse(t);
  }

  async create(user: User, dto: CreateActiveTimerDto) {
    const t = await this.prisma.activeTimer.create({
      data: {
        id: generateId(),
        userId: user.id,
        taskId: dto.taskId ?? '',
        taskTitle: dto.taskTitle ?? '',
        taskHierarchyId: dto.taskHierarchyId ?? '',
        projectId: dto.projectId ?? '',
        description: dto.description ?? '',
        startTime: new Date(dto.startTime),
        type: dto.type ?? 'TIMER',
        pomodoroSettings: (dto.pomodoroSettings ?? null) as Prisma.InputJsonValue,
      },
    });
    return activeTimerResponse(t);
  }

  async update(user: User, id: string, dto: UpdateActiveTimerDto): Promise<ReturnType<typeof activeTimerResponse>> {
    await this.ensureOwned(user, id);
    const data: Prisma.ActiveTimerUpdateInput = {};
    if (dto.isPaused !== undefined) data.isPaused = dto.isPaused;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.pomodoroSettings !== undefined) {
      data.pomodoroSettings = dto.pomodoroSettings as Prisma.InputJsonValue;
    }
    return activeTimerResponse(await this.prisma.activeTimer.update({ where: { id }, data }));
  }

  async remove(user: User, id: string): Promise<void> {
    await this.ensureOwned(user, id);
    await this.prisma.activeTimer.delete({ where: { id } });
  }

  /** Assert the timer exists AND belongs to the caller (else 404 — no cross-user access). */
  private async ensureOwned(user: User, id: string): Promise<void> {
    const row = await this.prisma.activeTimer.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!row || row.userId !== user.id) throw new NotFoundException('Not found.');
  }

  private timerOf(userId: string) {
    return this.prisma.activeTimer.findUnique({ where: { userId } });
  }
  timerForUser(userId: string): ReturnType<ActiveTimersService['timerOf']> {
    return this.timerOf(userId);
  }
}
