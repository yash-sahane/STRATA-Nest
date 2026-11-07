import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
  'status and progress are not written here: they are the epic roll-up of the work under ' +
  'it (its tasks, and its requirements that have none yet), kept by the server whenever ' +
  'that work changes. "Done" is a count comparison, never a rounded percentage.';

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
  /** Epic delete unlinks its tasks/FRs (epicId cleared) and removes only the epic (DeletionModule). */
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.deletion.delete(u, id); }
}
