import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { InviteCodesService, WorkspaceRolesService } from './collections.services';
import { CreateInviteCodeDto, CreateRoleDto, UpdateInviteCodeDto, UpdateRoleDto } from './dto';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('workspace_roles')
@Controller('workspace_roles')
export class WorkspaceRolesController {
  constructor(private readonly svc: WorkspaceRolesService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.RoleManage) create(@CurrentUser() u: User, @Body() d: CreateRoleDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateRoleDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

/** Every route requires `invite:manage`: an invite code IS a joinable secret,
 *  so its reads are as privileged as its writes (InviteCodesService.readPermission
 *  enforces the same scope for requests that carry no workspaceId). */
@ApiTags('invite_codes')
@Controller('invite_codes')
@RequirePermission(Permission.InviteManage)
export class InviteCodesController {
  constructor(private readonly svc: InviteCodesService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateInviteCodeDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateInviteCodeDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}
