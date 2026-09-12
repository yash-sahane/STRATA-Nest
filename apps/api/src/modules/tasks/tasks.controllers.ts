import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import {
  CreateKanbanColumnDto,
  CreateLabelDto,
  CreateTaskCommentDto,
  CreateTaskDto,
  TaskDependencyDto,
  TaskDependencyQueryDto,
  UpdateKanbanColumnDto,
  UpdateLabelDto,
  UpdateTaskCommentDto,
  UpdateTaskDto,
} from './dto';
import { TaskDeletionService } from '../deletion/task-deletion.service';
import { LabelsService, TasksService } from './tasks.services';
import { KanbanColumnsService, TaskCommentsService } from './unscoped.services';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly svc: TasksService,
    private readonly deletion: TaskDeletionService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.TaskWrite) create(@CurrentUser() u: User, @Body() d: CreateTaskDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTaskDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTaskDto) { return this.svc.patch(u, id, d); }
  /**
   * Dependency edges. Both halves (`blockedBy` on one task, `blocks` on the
   * other) are written in one transaction and the add is cycle-checked, which
   * two independent PATCHes from the client could never guarantee.
   */
  @Post(':id/dependencies') addDependency(@CurrentUser() u: User, @Param('id') id: string, @Body() d: TaskDependencyDto) { return this.svc.addDependency(u, id, d); }
  @Delete(':id/dependencies/:targetTaskId') removeDependency(@CurrentUser() u: User, @Param('id') id: string, @Param('targetTaskId') t: string, @Query() q: TaskDependencyQueryDto) { return this.svc.removeDependency(u, id, t, q.type); }
  /** Task aggregate delete → cascades TaskComments (DeletionModule). */
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.deletion.delete(u, id); }
}

@ApiTags('labels')
@Controller('labels')
export class LabelsController {
  constructor(private readonly svc: LabelsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.TaskWrite) create(@CurrentUser() u: User, @Body() d: CreateLabelDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateLabelDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateLabelDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

// --- Parent-scoped through Task / Project (membership-checked) ---

@ApiTags('task_comments')
@Controller('task_comments')
export class TaskCommentsController {
  constructor(private readonly svc: TaskCommentsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateTaskCommentDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTaskCommentDto) { return this.svc.update(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTaskCommentDto) { return this.svc.update(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

@ApiTags('kanban_columns')
@Controller('kanban_columns')
export class KanbanColumnsController {
  constructor(private readonly svc: KanbanColumnsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateKanbanColumnDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateKanbanColumnDto) { return this.svc.update(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateKanbanColumnDto) { return this.svc.update(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
