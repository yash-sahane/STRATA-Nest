import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import {
  CreateActiveTimerDto,
  CreateTimeEntryDto,
  RejectTimeEntryDto,
  StartTimerDto,
  StopTimerDto,
  UpdateActiveTimerDto,
  UpdateTimeEntryDto,
} from './dto';
import { ActiveTimersService, TimeEntriesService } from './time-tracking.services';
import { TimeApprovalService, TimerService } from './time-tracking.workflows';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('time_entries')
@Controller('time_entries')
export class TimeEntriesController {
  constructor(
    private readonly svc: TimeEntriesService,
    private readonly approvals: TimeApprovalService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.HrWrite) create(@CurrentUser() u: User, @Body() d: CreateTimeEntryDto) { return this.svc.create(u, d); }
  /** approve/reject — manager-only, self-approval blocked. */
  @Post(':id/approve') approve(@CurrentUser() u: User, @Param('id') id: string) { return this.approvals.approve(u, id); }
  @Post(':id/reject') reject(@CurrentUser() u: User, @Param('id') id: string, @Body() d: RejectTimeEntryDto) { return this.approvals.reject(u, id, d.reason); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTimeEntryDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTimeEntryDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

// ActiveTimer is user-tied (no workspace column): every read/write is
// scoped to the caller's own timer.
@ApiTags('active_timers')
@Controller('active_timers')
export class ActiveTimersController {
  constructor(
    private readonly svc: ActiveTimersService,
    private readonly timer: TimerService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateActiveTimerDto) { return this.svc.create(u, d); }
  /** timer lifecycle. */
  @Post('start') start(@CurrentUser() u: User, @Body() d: StartTimerDto) { return this.timer.start(u, d); }
  @Post('pause') pause(@CurrentUser() u: User) { return this.timer.pause(u); }
  @Post('resume') resume(@CurrentUser() u: User) { return this.timer.resume(u); }
  @Post('stop') stop(@CurrentUser() u: User, @Body() d: StopTimerDto) { return this.timer.stop(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateActiveTimerDto) { return this.svc.update(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateActiveTimerDto) { return this.svc.update(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
