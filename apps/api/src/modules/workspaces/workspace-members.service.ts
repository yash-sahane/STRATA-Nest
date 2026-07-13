import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { WorkspaceEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User, WorkspaceMember } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { CreateMemberDto, UpdateMemberDto } from './dto';
import { memberResponse } from './mappers';

const SPEC: ListQuerySpec = {
  filterable: {
    workspaceId: { field: 'workspaceId' },
    userId: { field: 'userId' },
    role: { field: 'role' },
    status: { field: 'status' },
  },
  sortable: { createdAt: 'createdAt', joinedAt: 'joinedAt' },
  defaultOrderBy: { createdAt: 'desc' },
};

type MemberUser = Pick<User, 'email' | 'name' | 'phone' | 'avatar'>;

@Injectable()
export class WorkspaceMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  private async usersFor(members: WorkspaceMember[]): Promise<Map<string, MemberUser>> {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, email: true, name: true, phone: true, avatar: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof memberResponse>>> {
    const scope = await this.access.scopeWhere(user);
    const parsed = parseListQuery(query, SPEC);
    const where: Prisma.WorkspaceMemberWhereInput = {
      AND: [scope, parsed.where as Prisma.WorkspaceMemberWhereInput],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspaceMember.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.WorkspaceMemberOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.workspaceMember.count({ where }),
    ]);
    const users = await this.usersFor(items);
    return paginate(
      items.map((m) => memberResponse(m, users.get(m.userId) ?? null)),
      total,
      parsed.page,
      parsed.pageSize,
    );
  }

  private async findScoped(user: User, id: string): Promise<WorkspaceMember> {
    const scope = await this.access.scopeWhere(user);
    const m = await this.prisma.workspaceMember.findFirst({ where: { AND: [scope, { id }] } });
    if (!m) throw new NotFoundException('Not found.');
    return m;
  }

  private async withUser(m: WorkspaceMember) {
    const users = await this.usersFor([m]);
    return memberResponse(m, users.get(m.userId) ?? null);
  }

  async retrieve(user: User, id: string) {
    return this.withUser(await this.findScoped(user, id));
  }

  async create(user: User, dto: CreateMemberDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.MemberInvite);
    const m = await this.prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: dto.workspaceId,
        userId: dto.userId,
        role: dto.role ?? 'MEMBER',
        status: dto.status ?? 'ACTIVE',
      },
    });
    this.emit(WorkspaceEvents.MemberAdded, m.workspaceId, {
      workspaceId: m.workspaceId,
      userId: m.userId,
      role: m.role,
      via: 'direct',
    });
    return this.withUser(m);
  }

  async update(user: User, id: string, dto: UpdateMemberDto) {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.MemberUpdate);
    const data: Prisma.WorkspaceMemberUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    const updated = await this.prisma.workspaceMember.update({ where: { id }, data });
    if (dto.role !== undefined && dto.role !== existing.role) {
      this.emit(WorkspaceEvents.MemberRoleChanged, updated.workspaceId, {
        workspaceId: updated.workspaceId,
        userId: updated.userId,
        role: updated.role,
        previousRole: existing.role,
      });
    }
    return this.withUser(updated);
  }

  async remove(user: User, id: string): Promise<void> {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.MemberRemove);
    await this.prisma.workspaceMember.delete({ where: { id } });
    this.emit(WorkspaceEvents.MemberRemoved, existing.workspaceId, {
      workspaceId: existing.workspaceId,
      userId: existing.userId,
      role: existing.role,
      via: 'direct',
    });
  }

  private emit(name: string, workspaceId: string, payload: Record<string, unknown>): void {
    this.events.emit(name, { name, workspaceId, payload, occurredAt: new Date().toISOString() });
  }
}
