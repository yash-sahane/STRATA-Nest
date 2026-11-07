import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ActivityLogsService } from './activity.services';

type Q = Record<string, string | string[] | undefined>;

/**
 * ActivityLog — read-only over HTTP. The trail is written by the server
 * (AuditSubscriber, audit-writer) as things happen; nothing may be posted into
 * it. A `POST` used to be open to every member, so any of them could add a
 * "leave approved" or "project deleted" line that never happened.
 */
@ApiTags('activity_logs')
@Controller('activity_logs')
export class ActivityLogsController {
  constructor(private readonly svc: ActivityLogsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  /** The actions the caller can see, for the feed's filter. Declared before
   *  `:id`, which would otherwise take "actions" for an id. */
  @Get('actions') actions(@CurrentUser() u: User, @Query() q: Q) { return this.svc.actions(u, q); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
}
