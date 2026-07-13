import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import {
  CreateRetrospectiveDto,
  CreateSprintDto,
  UpdateRetrospectiveDto,
  UpdateSprintDto,
} from './dto';
import { SprintDeletionService } from '../deletion/sprint-deletion.service';
import { SprintCompletionService } from './sprint-completion.service';
import { RetrospectivesService, SprintsService } from './sprints.services';

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
  /** Complete a sprint (close + seed retrospective, transactional). */
  @Post(':id/complete') complete(@CurrentUser() u: User, @Param('id') id: string) { return this.completion.complete(u, id); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateSprintDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateSprintDto) { return this.svc.patch(u, id, d); }
  /** Sprint aggregate delete → cascades Retrospectives (DeletionModule). */
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.deletion.delete(u, id); }
}

@ApiTags('retrospectives')
@Controller('retrospectives')
export class RetrospectivesController {
  constructor(private readonly svc: RetrospectivesService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.PlanningWrite) create(@CurrentUser() u: User, @Body() d: CreateRetrospectiveDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateRetrospectiveDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateRetrospectiveDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
