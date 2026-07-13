import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { AttendanceService, HolidaysService } from './attendance.services';
import {
  CheckInDto,
  CheckOutDto,
  CreateAttendanceDto,
  CreateHolidayDto,
  UpdateAttendanceDto,
  UpdateHolidayDto,
} from './dto';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.HrWrite) create(@CurrentUser() u: User, @Body() d: CreateAttendanceDto) { return this.svc.create(u, d); }
  /** Server-computed check-in/out. */
  @Post('check-in') @RequirePermission(Permission.HrWrite) checkIn(@CurrentUser() u: User, @Body() d: CheckInDto) { return this.svc.checkIn(u, d); }
  @Post('check-out') @RequirePermission(Permission.HrWrite) checkOut(@CurrentUser() u: User, @Body() d: CheckOutDto) { return this.svc.checkOut(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateAttendanceDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateAttendanceDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

@ApiTags('holidays')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly svc: HolidaysService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.HrWrite) create(@CurrentUser() u: User, @Body() d: CreateHolidayDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateHolidayDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateHolidayDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
