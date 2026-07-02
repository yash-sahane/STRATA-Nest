import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { ActivityLogsService, SavedSearchesService } from './activity.services';
import { CreateActivityLogDto, CreateSavedSearchDto, UpdateSavedSearchDto } from './dto';

type Q = Record<string, string | string[] | undefined>;

/**
 * ActivityLog — append-only: list/create/retrieve only. No PATCH/PUT/DELETE
 * routes are exposed, so the audit trail is immutable via the API (D9).
 */
@ApiTags('activity_logs')
@Controller('activity_logs')
export class ActivityLogsController {
  constructor(private readonly svc: ActivityLogsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.ActivityWrite) create(@CurrentUser() u: User, @Body() d: CreateActivityLogDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
}

@ApiTags('saved_searches')
@Controller('saved_searches')
export class SavedSearchesController {
  constructor(private readonly svc: SavedSearchesService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.ActivityWrite) create(@CurrentUser() u: User, @Body() d: CreateSavedSearchDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateSavedSearchDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateSavedSearchDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
