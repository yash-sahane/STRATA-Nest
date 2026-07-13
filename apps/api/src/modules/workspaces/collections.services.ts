import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { generateId, type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type {
  EmailInvitation,
  InviteCode,
  JoinRequest,
  PendingWorkspaceAccess,
  User,
  WorkspaceRole,
} from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type {
  CreateEmailInvitationDto,
  CreateInviteCodeDto,
  CreateJoinRequestDto,
  CreatePendingAccessDto,
  CreateRoleDto,
  UpdateEmailInvitationDto,
  UpdateInviteCodeDto,
  UpdateJoinRequestDto,
  UpdatePendingAccessDto,
  UpdateRoleDto,
} from './dto';
import {
  emailInvitationResponse,
  inviteCodeResponse,
  joinRequestResponse,
  pendingAccessResponse,
  roleResponse,
} from './mappers';
import { ScopedCrudService } from './scoped-crud.base';

const token = () => randomBytes(24).toString('base64url');
const code = () => randomBytes(8).toString('base64url').slice(0, 10).toUpperCase();

@Injectable()
export class WorkspaceRolesService extends ScopedCrudService<
  WorkspaceRole,
  ReturnType<typeof roleResponse>
> {
  protected readonly model = 'workspaceRole';
  protected readonly writePermission: PermissionKey = Permission.RoleManage;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, name: { field: 'name' } },
    sortable: { createdAt: 'createdAt', name: 'name' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: WorkspaceRole) {
    return roleResponse(row);
  }
  create(user: User, dto: CreateRoleDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      name: dto.name,
      permissions: dto.permissions ?? [],
    });
  }
  patch(user: User, id: string, dto: UpdateRoleDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.permissions !== undefined) data.permissions = dto.permissions;
    return this.update(user, id, data);
  }
}

@Injectable()
export class InviteCodesService extends ScopedCrudService<
  InviteCode,
  ReturnType<typeof inviteCodeResponse>
> {
  protected readonly model = 'inviteCode';
  protected readonly writePermission: PermissionKey = Permission.InviteManage;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, role: { field: 'role' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: InviteCode) {
    return inviteCodeResponse(row);
  }
  create(user: User, dto: CreateInviteCodeDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      code: dto.code ?? code(),
      role: dto.role ?? 'MEMBER',
      maxUses: dto.maxUses ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdById: user.id,
    });
  }
  patch(user: User, id: string, dto: UpdateInviteCodeDto) {
    const data: Record<string, unknown> = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    return this.update(user, id, data);
  }
}

@Injectable()
export class EmailInvitationsService extends ScopedCrudService<
  EmailInvitation,
  ReturnType<typeof emailInvitationResponse>
> {
  protected readonly model = 'emailInvitation';
  protected readonly writePermission: PermissionKey = Permission.InviteManage;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      email: { field: 'email' },
      status: { field: 'status' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: EmailInvitation) {
    return emailInvitationResponse(row);
  }
  create(user: User, dto: CreateEmailInvitationDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      email: dto.email.toLowerCase(),
      role: dto.role ?? 'MEMBER',
      token: dto.token ?? token(),
      status: dto.status ?? 'PENDING',
      expiresAt: new Date(dto.expiresAt),
      invitedById: user.id,
    });
  }
  patch(user: User, id: string, dto: UpdateEmailInvitationDto) {
    const data: Record<string, unknown> = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);
    return this.update(user, id, data);
  }
}

@Injectable()
export class JoinRequestsService extends ScopedCrudService<
  JoinRequest,
  ReturnType<typeof joinRequestResponse>
> {
  protected readonly model = 'joinRequest';
  protected readonly writePermission: PermissionKey = Permission.JoinManage;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: JoinRequest) {
    return joinRequestResponse(row);
  }
  /** Any authenticated user may request to join (they are not yet a member). */
  async create(user: User, dto: CreateJoinRequestDto) {
    const row = await this.prisma.joinRequest.create({
      data: {
        id: generateId(),
        workspaceId: dto.workspaceId,
        userId: user.id,
        message: dto.message ?? '',
      },
    });
    return joinRequestResponse(row);
  }
  patch(user: User, id: string, dto: UpdateJoinRequestDto) {
    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.handledBy !== undefined) data.handledById = dto.handledBy;
    return this.update(user, id, data);
  }
}

@Injectable()
export class PendingAccessService extends ScopedCrudService<
  PendingWorkspaceAccess,
  ReturnType<typeof pendingAccessResponse>
> {
  protected readonly model = 'pendingWorkspaceAccess';
  protected readonly writePermission: PermissionKey = Permission.JoinManage;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, userId: { field: 'userId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: PendingWorkspaceAccess) {
    return pendingAccessResponse(row);
  }
  async create(user: User, dto: CreatePendingAccessDto) {
    const row = await this.prisma.pendingWorkspaceAccess.create({
      data: {
        id: generateId(),
        workspaceId: dto.workspaceId,
        userId: user.id,
        requestedRole: dto.requestedRole ?? 'MEMBER',
      },
    });
    return pendingAccessResponse(row);
  }
  patch(user: User, id: string, dto: UpdatePendingAccessDto) {
    const data: Record<string, unknown> = {};
    if (dto.requestedRole !== undefined) data.requestedRole = dto.requestedRole;
    return this.update(user, id, data);
  }
}
