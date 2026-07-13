import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { WorkspaceEvents, type WorkspaceMemberAddedPayload } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto';
import { workspaceResponse } from './mappers';

const SPEC: ListQuerySpec = {
  filterable: { name: { field: 'name' }, ownerId: { field: 'ownerId' } },
  sortable: { createdAt: 'createdAt', name: 'name' },
  defaultOrderBy: { createdAt: 'desc' },
};

function generateInviteCode(): string {
  return randomBytes(8).toString('base64url').slice(0, 10).toUpperCase();
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  private async memberIds(workspaceIds: string[]): Promise<Map<string, string[]>> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { workspaceId: true, userId: true },
    });
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.workspaceId) ?? [];
      list.push(r.userId);
      map.set(r.workspaceId, list);
    }
    return map;
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof workspaceResponse>>> {
    const scope = await this.access.scopeWhere(user, 'id'); // Workspace is scoped by its own id
    const parsed = parseListQuery(query, SPEC);
    const where: Prisma.WorkspaceWhereInput = {
      AND: [scope, parsed.where as Prisma.WorkspaceWhereInput],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.WorkspaceOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.workspace.count({ where }),
    ]);
    const members = await this.memberIds(items.map((w) => w.id));
    return paginate(
      items.map((w) => workspaceResponse(w, members.get(w.id) ?? [])),
      total,
      parsed.page,
      parsed.pageSize,
    );
  }

  private async findScoped(user: User, id: string) {
    const scope = await this.access.scopeWhere(user, 'id');
    const ws = await this.prisma.workspace.findFirst({ where: { AND: [scope, { id }] } });
    if (!ws) throw new NotFoundException('Not found.');
    return ws;
  }

  async retrieve(user: User, id: string) {
    const ws = await this.findScoped(user, id);
    const members = await this.memberIds([ws.id]);
    return workspaceResponse(ws, members.get(ws.id) ?? []);
  }

  /** Any authenticated user may create a workspace; the creator becomes the
   *  owner and an ACTIVE MANAGER member, transactionally. */
  async create(user: User, dto: CreateWorkspaceDto) {
    const workspaceId = generateId();
    const [ws] = await this.prisma.$transaction([
      this.prisma.workspace.create({
        data: {
          id: workspaceId,
          name: dto.name,
          description: dto.description ?? '',
          logo: dto.logo ?? '',
          color: dto.color ?? '',
          ownerId: user.id,
          inviteCode: generateInviteCode(),
          settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
        },
      }),
      this.prisma.workspaceMember.create({
        data: {
          id: generateId(),
          workspaceId,
          userId: user.id,
          role: 'MANAGER',
          status: 'ACTIVE',
        },
      }),
    ]);
    // Post-commit side effect: membership event.
    this.emitMemberAdded({ workspaceId, userId: user.id, role: 'MANAGER', via: 'direct' });
    return workspaceResponse(ws, [user.id]);
  }

  async update(user: User, id: string, dto: UpdateWorkspaceDto) {
    const ws = await this.findScoped(user, id);
    await this.access.assertPermission(user, ws.id, Permission.WorkspaceUpdate);
    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.logo !== undefined) data.logo = dto.logo;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.settings !== undefined) data.settings = dto.settings as Prisma.InputJsonValue;
    const updated = await this.prisma.workspace.update({ where: { id: ws.id }, data });
    const members = await this.memberIds([updated.id]);
    return workspaceResponse(updated, members.get(updated.id) ?? []);
  }

  async remove(user: User, id: string): Promise<void> {
    const ws = await this.findScoped(user, id);
    await this.access.assertPermission(user, ws.id, Permission.WorkspaceDelete);
    await this.prisma.workspace.delete({ where: { id: ws.id } });
  }

  emitMemberAdded(payload: WorkspaceMemberAddedPayload): void {
    this.events.emit(WorkspaceEvents.MemberAdded, {
      name: WorkspaceEvents.MemberAdded,
      workspaceId: payload.workspaceId,
      payload,
      occurredAt: new Date().toISOString(),
    });
  }
}
