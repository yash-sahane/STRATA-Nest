import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AcceptInvitationDto, CreateWorkspaceDto, UpdateWorkspaceDto } from './dto';
import { InvitationAcceptanceService } from './workflows.services';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly invitations: InvitationAcceptanceService,
  ) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: Record<string, string | string[] | undefined>) {
    return this.workspaces.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user, dto);
  }

  /** [NEW] Accept an email invitation (token) or invite code — transactional workflow. */
  @Post('accept-invitation')
  acceptInvitation(@CurrentUser() user: User, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(user, dto);
  }

  @Get(':id')
  retrieve(@CurrentUser() user: User, @Param('id') id: string) {
    return this.workspaces.retrieve(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(user, id, dto);
  }

  @Put(':id')
  replace(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.workspaces.remove(user, id);
  }
}
