import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { isValidTimeZone } from '@strata/config';

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

  /**
   * Workspaces the caller could ask to join — id and name only.
   *
   * `list()` is scoped to workspaces you are already in, which is correct for
   * every other screen but made POST /join_requests unusable: it requires a
   * `workspaceId` and nothing let a non-member discover one, so the whole
   * request-to-join flow was unreachable from the client.
   *
   * DISCLOSURE: this deliberately shows workspace NAMES to any authenticated
   * user, which is what a request-access flow requires. Nothing else is
   * exposed — no members, no settings, no counts — and workspaces the caller
   * already belongs to are filtered out, so it reveals only "these are the
   * teams you could ask to join".
   */
  async directory(user: User): Promise<Array<{ id: string; name: string; requested: boolean }>> {
    const [memberships, pending] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { workspaceId: true },
      }),
      this.prisma.joinRequest.findMany({
        where: { userId: user.id, status: 'PENDING' },
        select: { workspaceId: true },
      }),
    ]);
    const mine = new Set(memberships.map((m) => m.workspaceId));
    const asked = new Set(pending.map((r) => r.workspaceId));

    const rows = await this.prisma.workspace.findMany({
      where: { id: { notIn: [...mine] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    // `requested` lets the client disable a workspace the user has already
    // asked about rather than letting them queue duplicates the API refuses.
    return rows.map((w) => ({ ...w, requested: asked.has(w.id) }));
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

  /** Workspace creation is a platform-admin action — every client surface says
   *  so (onboarding, the workspace guard, the switcher), and the creator is
   *  stamped as owner and ACTIVE MANAGER, so leaving it open let any account
   *  mint itself a tenant it fully controls. Enforced here, not in the UI. */
  async create(user: User, dto: CreateWorkspaceDto) {
    if (!this.access.isPlatformAdmin(user)) {
      throw new ForbiddenException('Only administrators can create workspaces');
    }
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
    if (dto.settings !== undefined) {
      // A timezone the runtime does not recognise would be silently ignored by every
      // consumer and quietly leave attendance on the server's zone, so it is refused here
      // rather than stored and forgotten.
      const incoming = (dto.settings ?? {}) as Record<string, unknown>;
      if (incoming.timezone !== undefined && incoming.timezone !== null && incoming.timezone !== '') {
        if (typeof incoming.timezone !== 'string' || !isValidTimeZone(incoming.timezone)) {
          throw new BadRequestException(
            `'${String(incoming.timezone)}' is not a recognised IANA timezone (for example 'Asia/Kolkata').`,
          );
        }
      }
      data.settings = dto.settings as Prisma.InputJsonValue;
    }
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
