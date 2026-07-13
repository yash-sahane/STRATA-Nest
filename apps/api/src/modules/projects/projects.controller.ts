import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { ProjectDeletionService } from '../deletion/project-deletion.service';
import { CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly deletion: ProjectDeletionService,
  ) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: Record<string, string | string[] | undefined>) {
    return this.projects.list(user, query);
  }

  @Post()
  @RequirePermission(Permission.ProjectCreate)
  create(@CurrentUser() user: User, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Get(':id')
  retrieve(@CurrentUser() user: User, @Param('id') id: string) {
    return this.projects.retrieve(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user, id, dto);
  }

  @Put(':id')
  replace(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.deletion.delete(user, id);
  }
}
