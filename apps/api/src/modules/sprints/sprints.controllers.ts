import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { CreateSprintDto, UpdateSprintDto } from './dto';
import { SprintDeletionService } from '../deletion/sprint-deletion.service';
import { SprintCompletionService } from './sprint-completion.service';
import { SprintsService } from './sprints.services';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('sprints')
@Controller('sprints')
export class SprintsController {
  constructor(
    private readonly svc: SprintsService,
    private readonly completion: SprintCompletionService,
    private readonly deletion: SprintDeletionService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.PlanningWrite) create(@CurrentUser() u: User, @Body() d: CreateSprintDto) { return this.svc.create(u, d); }
  /** Complete a sprint: close it and record what it got through. */
  @Post(':id/complete') complete(@CurrentUser() u: User, @Param('id') id: string) { return this.completion.complete(u, id); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateSprintDto) { return this.svc.patch(u, id, d); }
  /** Sprint aggregate delete — its work goes back to the backlog (DeletionModule). */
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.deletion.delete(u, id); }
}
