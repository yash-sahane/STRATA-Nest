import { Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { LeaveBalance, LeaveRequest, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type {
  CreateLeaveBalanceDto,
  CreateLeaveRequestDto,
  UpdateLeaveBalanceDto,
  UpdateLeaveRequestDto,
} from './dto';
import { leaveBalanceResponse, leaveRequestResponse } from './mappers';

@Injectable()
export class LeaveRequestsService extends ScopedCrudService<
  LeaveRequest,
  ReturnType<typeof leaveRequestResponse>
> {
  protected readonly model = 'leaveRequest';
  protected readonly writePermission: PermissionKey = Permission.HrWrite; // members submit their own
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
      type: { field: 'type' },
    },
    sortable: { createdAt: 'createdAt', startDate: 'startDate' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: LeaveRequest) {
    return leaveRequestResponse(row);
  }
  create(user: User, dto: CreateLeaveRequestDto) {
    // user + createdById are stamped from the caller.
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: user.id,
      createdById: user.id,
      createdByName: user.name ?? '',
      type: dto.type,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      reason: dto.reason,
      status: 'PENDING',
      daysCount: dto.daysCount ?? 0,
    });
  }
  patch(user: User, id: string, dto: UpdateLeaveRequestDto) {
    const data: Record<string, unknown> = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.daysCount !== undefined) data.daysCount = dto.daysCount;
    return this.update(user, id, data);
  }
}

@Injectable()
export class LeaveBalancesService extends ScopedCrudService<
  LeaveBalance,
  ReturnType<typeof leaveBalanceResponse>
> {
  protected readonly model = 'leaveBalance';
  protected readonly writePermission: PermissionKey = Permission.LeaveApprove; // balances are manager-managed
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      year: { field: 'year', type: 'number' },
    },
    sortable: { createdAt: 'createdAt', year: 'year' },
    defaultOrderBy: { year: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: LeaveBalance) {
    return leaveBalanceResponse(row);
  }
  create(user: User, dto: CreateLeaveBalanceDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      year: dto.year,
      paidLeave: dto.paidLeave ?? 0,
      unpaidLeave: dto.unpaidLeave ?? 0,
      halfDay: dto.halfDay ?? 0,
      compOff: dto.compOff ?? 0,
    });
  }
  patch(user: User, id: string, dto: UpdateLeaveBalanceDto) {
    const data: Record<string, unknown> = {};
    if (dto.paidLeave !== undefined) data.paidLeave = dto.paidLeave;
    if (dto.unpaidLeave !== undefined) data.unpaidLeave = dto.unpaidLeave;
    if (dto.halfDay !== undefined) data.halfDay = dto.halfDay;
    if (dto.compOff !== undefined) data.compOff = dto.compOff;
    return this.update(user, id, data);
  }
}
