import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { DeadlineReminderService } from './deadline-reminder.service';
import { CreateNotificationDto, DeadlineScanDto, UpdateNotificationDto } from './dto';
import { NotificationsService } from './notifications.service';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly svc: NotificationsService,
    private readonly deadlines: DeadlineReminderService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.NotificationWrite) create(@CurrentUser() u: User, @Body() d: CreateNotificationDto) { return this.svc.create(u, d); }
  /** Mark every unread notification of the caller as read → { updated }. */
  @Post('mark_all_read') @HttpCode(200) markAllRead(@CurrentUser() u: User) { return this.svc.markAllRead(u); }
  /**
   * Run the workspace's daily deadline/overdue reminder scan → { scanned, created }.
   * Any member may ask; the first request of the UTC day does the work and the
   * scan itself is idempotent, so this cannot be used to spam anyone. No
   * NotificationWrite is required precisely because the caller supplies no
   * recipient — that is what made the old browser-side scan a write primitive.
   */
  @Post('deadline_scan') @HttpCode(200) deadlineScan(@CurrentUser() u: User, @Body() d: DeadlineScanDto) { return this.deadlines.runForWorkspace(u, d.workspaceId); }
  /** Clear the caller's whole inbox in one request -> { deleted }. */
  @Delete() @HttpCode(200) removeAll(@CurrentUser() u: User) { return this.svc.removeAll(u); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateNotificationDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateNotificationDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
