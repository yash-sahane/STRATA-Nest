import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { EpicDeletionService } from '../deletion/epic-deletion.service';
import { CreateEpicDto, UpdateEpicDto } from './dto';
import { EpicsService } from './epics.service';

type Q = Record<string, string | string[] | undefined>;

/**
 * The rollup rule, on the Swagger surface as well as on UpdateEpicDto — it is
 * the one place this API does something a caller cannot guess from the DTO.
 */
const ROLLUP_NOTE =
  'progress and status are the epic task rollup. A body containing ONLY those two is ' +
  'also accepted from a caller holding task:update (not just planning:write); for that ' +
  'caller both values are recomputed from the epic tasks and the submitted numbers are ' +
  'ignored, so task:update cannot declare an epic complete. A planning:write caller keeps ' +
  'the progress it sent, but any body carrying a progress has its status recomputed from ' +
  'the task counts (every task done is a count comparison, never a rounded percentage), so ' +
  'the pair cannot contradict itself; a status sent alone is a human decision and is stored ' +
  'verbatim. Any body that also touches a human-authored field is an ordinary update and ' +
  'requires planning:write.';

@ApiTags('epics')
@Controller('epics')
export class EpicsController {
  constructor(
    private readonly svc: EpicsService,
    private readonly deletion: EpicDeletionService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.PlanningWrite) create(@CurrentUser() u: User, @Body() d: CreateEpicDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') @ApiOperation({ description: ROLLUP_NOTE }) patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateEpicDto) { return this.svc.patch(u, id, d); }
  @Put(':id') @ApiOperation({ description: ROLLUP_NOTE }) put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateEpicDto) { return this.svc.patch(u, id, d); }
  /** Epic delete unlinks its tasks/FRs (epicId cleared) and removes only the epic (DeletionModule). */
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.deletion.delete(u, id); }
}
