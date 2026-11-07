import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WorkspaceDeletionService } from '../deletion/workspace-deletion.service';
import {
  AcceptInvitationDto,
  CreateWorkspaceDto,
  TransferOwnershipDto,
  UpdateWorkspaceDto,
} from './dto';
import { InvitationAcceptanceService } from './workflows.services';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly invitations: InvitationAcceptanceService,
    private readonly deletion: WorkspaceDeletionService,
    private readonly members: WorkspaceMembersService,
  ) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: Record<string, string | string[] | undefined>) {
    return this.workspaces.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user, dto);
  }

  /** Redeem an invite code — transactional workflow. */
  @Post('accept-invitation')
  acceptInvitation(@CurrentUser() user: User, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(user, dto);
  }

  /** End the caller's own membership. No permission: it is theirs to end. */
  @Post(':id/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: User, @Param('id') id: string) {
    return this.members.leave(user, id);
  }

  /** Hand the workspace to another of its managers (owner or platform admin). */
  @Post(':id/transfer-ownership')
  transferOwnership(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.workspaces.transferOwnership(user, id, dto.userId);
  }

  /** Declared before `:id` — otherwise Nest matches "directory" as a workspace id. */
  @Get('directory')
  directory(@CurrentUser() user: User) {
    return this.workspaces.directory(user);
  }

  @Get(':id')
  retrieve(@CurrentUser() user: User, @Param('id') id: string) {
    return this.workspaces.retrieve(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(user, id, dto);
  }

  /** Aggregate-root delete — orchestrated cascade (DeletionModule), not a bare row delete. */
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.deletion.delete(user, id);
  }
}
