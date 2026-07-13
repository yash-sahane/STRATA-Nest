import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import {
  CreateLeaveBalanceDto,
  CreateLeaveRequestDto,
  RejectLeaveDto,
  UpdateLeaveBalanceDto,
  UpdateLeaveRequestDto,
} from './dto';
import { LeaveApprovalService } from './leave-approval.service';
import { LeaveBalancesService, LeaveRequestsService } from './leave.services';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('leave_requests')
@Controller('leave_requests')
export class LeaveRequestsController {
  constructor(
    private readonly svc: LeaveRequestsService,
    private readonly approvals: LeaveApprovalService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.HrWrite) create(@CurrentUser() u: User, @Body() d: CreateLeaveRequestDto) { return this.svc.create(u, d); }
  /** approve (deducts balance) / reject — manager-only, self-approval blocked. */
  @Post(':id/approve') approve(@CurrentUser() u: User, @Param('id') id: string) { return this.approvals.approve(u, id); }
  @Post(':id/reject') reject(@CurrentUser() u: User, @Param('id') id: string, @Body() d: RejectLeaveDto) { return this.approvals.reject(u, id, d.reason); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateLeaveRequestDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateLeaveRequestDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

@ApiTags('leave_balances')
@Controller('leave_balances')
export class LeaveBalancesController {
  constructor(private readonly svc: LeaveBalancesService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.LeaveApprove) create(@CurrentUser() u: User, @Body() d: CreateLeaveBalanceDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateLeaveBalanceDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateLeaveBalanceDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
