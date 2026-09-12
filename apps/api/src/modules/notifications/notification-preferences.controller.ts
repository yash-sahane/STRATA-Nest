import { Body, Controller, Get, HttpCode, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReplaceNotificationPreferencesDto } from './dto';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * The Settings → Notifications screen. Read/write is recipient-only by
 * construction: neither endpoint accepts a `userId`, so a member can only ever
 * see and change their own delivery toggles.
 */
@ApiTags('notifications')
@Controller('notification_preferences')
export class NotificationPreferencesController {
  constructor(private readonly svc: NotificationPreferencesService) {}

  @Get() list(@CurrentUser() u: User, @Query('workspaceId') workspaceId?: string) {
    return this.svc.listMine(u, workspaceId);
  }

  @Put() @HttpCode(200) replace(@CurrentUser() u: User, @Body() d: ReplaceNotificationPreferencesDto) {
    return this.svc.replaceMine(u, d);
  }
}
