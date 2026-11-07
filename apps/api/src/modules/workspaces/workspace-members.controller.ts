import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { CreateMemberDto, UpdateMemberDto } from './dto';
import { WorkspaceMembersService } from './workspace-members.service';

@ApiTags('workspace_members')
@Controller('workspace_members')
export class WorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: Record<string, string | string[] | undefined>) {
    return this.members.list(user, query);
  }

  @Post()
  @RequirePermission(Permission.MemberInvite)
  create(@CurrentUser() user: User, @Body() dto: CreateMemberDto) {
    return this.members.create(user, dto);
  }

  /** The invitations waiting on the caller, from whichever workspace. Declared
   *  before `:id`, which would otherwise take "invitations" for an id. */
  @Get('invitations')
  invitations(@CurrentUser() user: User) {
    return this.members.invitations(user);
  }

  /** The invited person saying yes. Theirs alone: no permission is asked,
   *  because the row is looked up by id AND the caller. */
  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: User, @Param('id') id: string) {
    return this.members.accept(user, id);
  }

  /** The invited person saying no. The invitation is deleted. */
  @Post(':id/decline')
  @HttpCode(204)
  decline(@CurrentUser() user: User, @Param('id') id: string) {
    return this.members.decline(user, id);
  }

  /** What removing this member would leave behind — asked before a removal. */
  @Get(':id/footprint')
  footprint(@CurrentUser() user: User, @Param('id') id: string) {
    return this.members.footprint(user, id);
  }

  @Get(':id')
  retrieve(@CurrentUser() user: User, @Param('id') id: string) {
    return this.members.retrieve(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.members.remove(user, id);
  }
}
