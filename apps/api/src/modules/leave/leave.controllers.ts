import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import {
  AdjustLeaveBalanceDto,
  CreateLeaveRequestDto,
  RejectLeaveDto,
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
  /** cancel — the requester withdraws their own (or an approver cancels), restoring any deducted balance. */
  @Post(':id/cancel') cancel(@CurrentUser() u: User, @Param('id') id: string) { return this.approvals.cancel(u, id); }
  /** Who is away: every approved absence in the workspace, dates only — no type, no reason. */
  @Get('away') away(@CurrentUser() u: User, @Query('workspaceId') workspaceId: string, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.away(u, workspaceId, from, to); }
  /** Who decides leave here. */
  @Get('approvers') approvers(@CurrentUser() u: User, @Query('workspaceId') workspaceId: string) { return this.svc.approvers(u, workspaceId); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateLeaveRequestDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

@ApiTags('leave_balances')
@Controller('leave_balances')
export class LeaveBalancesController {
  constructor(private readonly svc: LeaveBalancesService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  /** The caller's own balance, provisioned on first read (members cannot POST one). */
  @Get('me') mine(@CurrentUser() u: User, @Query('workspaceId') workspaceId: string, @Query('year') year?: string) {
    return this.svc.mine(u, workspaceId, year ? Number(year) : undefined);
  }
  /** Every active member's balance for a year — the approver's allocation screen. */
  @Get('team') team(@CurrentUser() u: User, @Query('workspaceId') workspaceId: string, @Query('year') year?: string) {
    return this.svc.team(u, workspaceId, year ? Number(year) : undefined);
  }
  /** Set one member's allowance (provisioning their row if they have none yet). */
  @Post('adjust') @HttpCode(200) @RequirePermission(Permission.LeaveApprove) adjust(@CurrentUser() u: User, @Body() d: AdjustLeaveBalanceDto) { return this.svc.adjust(u, d); }
  // No generic create/update/delete: `adjust` is the one way a balance changes.
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
}
