import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { ProjectDeletionService } from '../deletion/project-deletion.service';
import { CloneProjectDto, CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectCloneService } from './project-clone.service';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly deletion: ProjectDeletionService,
    private readonly cloning: ProjectCloneService,
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

  /**
   * A copy of the project in the same workspace, made in one transaction. The
   * permissions are checked by the service: which ones depends on the parts
   * asked for, and the workspace is the source project's.
   */
  @Post(':id/clone')
  clone(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CloneProjectDto) {
    return this.cloning.clone(user, id, dto);
  }

  @Get(':id')
  retrieve(@CurrentUser() user: User, @Param('id') id: string) {
    return this.projects.retrieve(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.deletion.delete(user, id);
  }
}
