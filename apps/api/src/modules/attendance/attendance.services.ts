import { BadRequestException, Injectable } from '@nestjs/common';
import { generateId, type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Attendance, Holiday, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import {
  calculateLateMinutes,
  calculateWorkHours,
  determineAttendanceStatus,
  isLateCheckIn,
  isWeekend,
} from './attendance-compute';
import type {
  CheckInDto,
  CheckOutDto,
  CreateAttendanceDto,
  CreateHolidayDto,
  UpdateAttendanceDto,
  UpdateHolidayDto,
} from './dto';
import { attendanceResponse, holidayResponse } from './mappers';

const todayUtc = (): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

@Injectable()
export class AttendanceService extends ScopedCrudService<
  Attendance,
  ReturnType<typeof attendanceResponse>
> {
  protected readonly model = 'attendance';
  protected readonly writePermission: PermissionKey = Permission.HrWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
      date: { field: 'date', type: 'date' },
    },
    sortable: { createdAt: 'createdAt', date: 'date' },
    defaultOrderBy: { date: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Attendance) {
    return attendanceResponse(row);
  }
  create(user: User, dto: CreateAttendanceDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      date: new Date(dto.date),
      checkInTime: new Date(dto.checkInTime),
      checkOutTime: dto.checkOutTime ? new Date(dto.checkOutTime) : null,
      workHours: dto.workHours ?? null,
      status: dto.status ?? 'PRESENT',
      lateMinutes: dto.lateMinutes ?? 0,
      location: dto.location ?? '',
      notes: dto.notes ?? '',
      isWeekend: dto.isWeekend ?? false,
      isHoliday: dto.isHoliday ?? false,
    });
  }
  patch(user: User, id: string, dto: UpdateAttendanceDto) {
    const data: Record<string, unknown> = {};
    if (dto.checkOutTime !== undefined) data.checkOutTime = dto.checkOutTime ? new Date(dto.checkOutTime) : null;
    if (dto.workHours !== undefined) data.workHours = dto.workHours;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.lateMinutes !== undefined) data.lateMinutes = dto.lateMinutes;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isWeekend !== undefined) data.isWeekend = dto.isWeekend;
    if (dto.isHoliday !== undefined) data.isHoliday = dto.isHoliday;
    return this.update(user, id, data);
  }

  /** Server-computed check-in (lateMinutes + status). */
  async checkIn(user: User, dto: CheckInDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.HrWrite);
    const date = todayUtc();
    const existing = await this.prisma.attendance.findFirst({
      where: { workspaceId: dto.workspaceId, userId: user.id, date },
    });
    if (existing) throw new BadRequestException('Already checked in today');
    const now = new Date();
    const record = await this.prisma.attendance.create({
      data: {
        id: generateId(),
        workspaceId: dto.workspaceId,
        userId: user.id,
        date,
        checkInTime: now,
        lateMinutes: calculateLateMinutes(now),
        status: isLateCheckIn(now) ? 'LATE' : 'PRESENT',
        isWeekend: isWeekend(now),
        location: dto.location ?? '',
        notes: dto.notes ?? '',
        createdById: user.id,
        createdByName: user.name ?? '',
      },
    });
    return attendanceResponse(record);
  }

  /** Server-computed check-out (workHours + status). */
  async checkOut(user: User, dto: CheckOutDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.HrWrite);
    const date = todayUtc();
    const record = await this.prisma.attendance.findFirst({
      where: { workspaceId: dto.workspaceId, userId: user.id, date },
    });
    if (!record) throw new BadRequestException('Not checked in today');
    if (record.checkOutTime) throw new BadRequestException('Already checked out today');
    const now = new Date();
    const workHours = calculateWorkHours(record.checkInTime, now);
    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOutTime: now,
        workHours,
        status: determineAttendanceStatus(record.checkInTime, now, workHours),
      },
    });
    return attendanceResponse(updated);
  }
}

@Injectable()
export class HolidaysService extends ScopedCrudService<Holiday, ReturnType<typeof holidayResponse>> {
  protected readonly model = 'holiday';
  protected readonly writePermission: PermissionKey = Permission.HrWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, date: { field: 'date', type: 'date' } },
    sortable: { createdAt: 'createdAt', date: 'date' },
    defaultOrderBy: { date: 'asc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Holiday) {
    return holidayResponse(row);
  }
  create(user: User, dto: CreateHolidayDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      name: dto.name,
      date: new Date(dto.date),
      isOptional: dto.isOptional ?? false,
      description: dto.description ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateHolidayDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.isOptional !== undefined) data.isOptional = dto.isOptional;
    if (dto.description !== undefined) data.description = dto.description;
    return this.update(user, id, data);
  }
}
