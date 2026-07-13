import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PasswordService } from '../auth/services/password.service';
import type { InviteUserDto, UpdateUserDto } from './dto';
import { UserMapper, type UserResponse } from './user.mapper';

const USER_ROLES = new Set([
  'MANAGER',
  'ASSISTANT_MANAGER',
  'SOFTWARE_DEVELOPER',
  'DEVELOPER_INTERN',
  'TESTER',
  'CONTENT_ENGINEER',
  'MEMBER',
]);

const USER_LIST_SPEC: ListQuerySpec = {
  filterable: {
    email: { field: 'email' },
    name: { field: 'name' },
    role: { field: 'role' },
    status: { field: 'status' },
    workspaceId: { field: 'workspaceId' },
  },
  sortable: { createdAt: 'createdAt', name: 'name', email: 'email' },
  defaultOrderBy: { createdAt: 'desc' },
};

export type SoftError = { softError: { status: number; message: string } };
export type InviteResult = SoftError | { status: number; body: Record<string, unknown> };

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userMapper: UserMapper,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  private isPlatformAdmin(user: User): boolean {
    return user.isSuperuser || user.isAdminFlag;
  }

  /** Prisma `where` restricting the User set to the caller's directory. */
  private async directoryScope(caller: User): Promise<Prisma.UserWhereInput> {
    if (this.isPlatformAdmin(caller)) return {};
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: caller.id, status: 'ACTIVE' },
      select: { workspaceId: true },
    });
    const wsIds = memberships.map((m) => m.workspaceId);
    const peers = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: { in: wsIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const ids = Array.from(new Set([...peers.map((p) => p.userId), caller.id]));
    return { id: { in: ids } };
  }

  async list(
    caller: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<UserResponse>> {
    const scope = await this.directoryScope(caller);
    const parsed = parseListQuery(query, USER_LIST_SPEC);
    const where: Prisma.UserWhereInput = { AND: [scope, parsed.where as Prisma.UserWhereInput] };
    const orderBy = parsed.orderBy as
      | Prisma.UserOrderByWithRelationInput
      | Prisma.UserOrderByWithRelationInput[];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy, skip: parsed.skip, take: parsed.take }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(await this.userMapper.toResponseMany(items), total, parsed.page, parsed.pageSize);
  }

  async retrieve(caller: User, id: string): Promise<UserResponse> {
    const scope = await this.directoryScope(caller);
    const user = await this.prisma.user.findFirst({ where: { AND: [scope, { id }] } });
    if (!user) throw new NotFoundException('No User matches the given query.');
    return this.userMapper.toResponse(user);
  }

  async update(caller: User, id: string, dto: UpdateUserDto): Promise<UserResponse | SoftError> {
    const scope = await this.directoryScope(caller);
    const target = await this.prisma.user.findFirst({ where: { AND: [scope, { id }] } });
    if (!target) throw new NotFoundException('No User matches the given query.');
    if (target.id !== caller.id && !this.isPlatformAdmin(caller)) {
      return { softError: { status: 403, message: 'Forbidden' } }; // plain {message} 403 body (frozen contract)
    }
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.workspaceId !== undefined) data.workspaceId = dto.workspaceId;
    if (dto.email !== undefined) data.email = dto.email;
    const updated = Object.keys(data).length
      ? await this.prisma.user.update({ where: { id: target.id }, data })
      : target;
    return this.userMapper.toResponse(updated);
  }

  async invite(caller: User, dto: InviteUserDto): Promise<InviteResult> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspaceId } });
    if (!workspace) return { softError: { status: 404, message: 'Workspace not found' } };

    const callerMembership = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: workspace.id, userId: caller.id, status: 'ACTIVE' },
    });
    if (!callerMembership && !this.isPlatformAdmin(caller) && workspace.ownerId !== caller.id) {
      return { softError: { status: 403, message: 'Not authorised to invite into this workspace' } };
    }

    const roleName = dto.roleName ?? 'MEMBER';
    const workspaceName = dto.workspaceName || workspace.name;
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existing) {
      const already = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: existing.id },
      });
      if (already) {
        return { softError: { status: 400, message: 'User is already a member of this workspace' } };
      }
      await this.prisma.workspaceMember.create({
        data: {
          id: generateId(),
          workspaceId: workspace.id,
          userId: existing.id,
          role: roleName,
          status: 'ACTIVE',
        },
      });
      await this.mail.sendWorkspaceInvitation(
        existing.email,
        workspaceName,
        caller.name || caller.email,
        workspace.inviteCode,
      );
      return {
        status: 200,
        body: {
          success: true,
          type: 'invitation',
          userId: existing.id,
          message: 'Workspace invitation sent to existing user',
        },
      };
    }

    const tempPassword = this.tempPassword();
    const newUser = await this.prisma.user.create({
      data: {
        id: generateId(),
        email,
        password: this.passwords.hash(tempPassword),
        name: dto.name,
        role: USER_ROLES.has(roleName) ? roleName : 'MEMBER',
        workspaceId: workspace.id,
        hasTempPassword: true,
      },
    });
    await this.prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: workspace.id,
        userId: newUser.id,
        role: roleName,
        status: 'ACTIVE',
      },
    });
    await this.mail.sendWelcome(newUser.email, newUser.name, tempPassword);
    return {
      status: 201,
      body: {
        success: true,
        type: 'new_user',
        userId: newUser.id,
        message: 'User created successfully',
      },
    };
  }

  private tempPassword(length = 12): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }
}
