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
  UpdateKanbanColumnDto,
  UpdateLabelDto,
  UpdateTaskCommentDto,
  UpdateTaskDto,
} from './dto';
import { LabelsService, TasksService } from './tasks.services';
import { KanbanColumnsService, TaskCommentsService } from './unscoped.services';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.TaskWrite) create(@CurrentUser() u: User, @Body() d: CreateTaskDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTaskDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateTaskDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
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

// --- Unscoped (Django parity: no workspace scope) ---

@ApiTags('task_comments')
@Controller('task_comments')
export class TaskCommentsController {
  constructor(private readonly svc: TaskCommentsService) {}
  @Get() list(@Query() q: Q) { return this.svc.list(q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateTaskCommentDto) { return this.svc.create(u, d); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.retrieve(id); }
  @Patch(':id') patch(@Param('id') id: string, @Body() d: UpdateTaskCommentDto) { return this.svc.update(id, d); }
  @Put(':id') put(@Param('id') id: string, @Body() d: UpdateTaskCommentDto) { return this.svc.update(id, d); }
  @Delete(':id') @HttpCode(204) remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@ApiTags('kanban_columns')
@Controller('kanban_columns')
export class KanbanColumnsController {
  constructor(private readonly svc: KanbanColumnsService) {}
  @Get() list(@Query() q: Q) { return this.svc.list(q); }
  @Post() create(@Body() d: CreateKanbanColumnDto) { return this.svc.create(d); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.retrieve(id); }
  @Patch(':id') patch(@Param('id') id: string, @Body() d: UpdateKanbanColumnDto) { return this.svc.update(id, d); }
  @Put(':id') put(@Param('id') id: string, @Body() d: UpdateKanbanColumnDto) { return this.svc.update(id, d); }
  @Delete(':id') @HttpCode(204) remove(@Param('id') id: string) { return this.svc.remove(id); }
}
