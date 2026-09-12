import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type {
  CreateKanbanColumnDto,
  CreateTaskCommentDto,
  UpdateKanbanColumnDto,
  UpdateTaskCommentDto,
} from './dto';
import { kanbanColumnResponse, taskCommentResponse } from './mappers';

/**
 * TaskComment / KanbanColumn have no workspace column of their own; they are
 * scoped through their parent (Task / Project respectively). Every read/write
 * of a single record verifies the caller is a member of the parent's
 * workspace, so no one can read, edit, or delete another workspace's comment
 * or column by guessing its id.
 */
@Injectable()
export class TaskCommentsService {
  private readonly spec: ListQuerySpec = {
    filterable: { taskId: { field: 'taskId' }, userId: { field: 'userId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof taskCommentResponse>>> {
    // Scoped read path: a caller must name the parent task and be a member of
    // its workspace. (An unfiltered cross-workspace listing is intentionally
    // not offered here.)
    const taskId = typeof query.taskId === 'string' ? query.taskId : undefined;
    if (!taskId) throw new NotFoundException('Not found.');
    await this.assertTaskAccess(user, taskId);
    const parsed = parseListQuery(query, this.spec);
    const where = parsed.where as Prisma.TaskCommentWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskComment.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.TaskCommentOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.taskComment.count({ where }),
    ]);
    return paginate(items.map(taskCommentResponse), total, parsed.page, parsed.pageSize);
  }

  async retrieve(user: User, id: string) {
    const c = await this.prisma.taskComment.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Not found.');
    await this.assertTaskAccess(user, c.taskId);
    return taskCommentResponse(c);
  }

  async create(user: User, dto: CreateTaskCommentDto) {
    await this.assertTaskAccess(user, dto.taskId);
    const c = await this.prisma.taskComment.create({
      data: {
        id: generateId(),
        taskId: dto.taskId,
        userId: user.id, // stamped from the caller
        content: dto.content,
        mentions: (dto.mentions ?? []) as Prisma.InputJsonValue,
        attachments: (dto.attachments ?? []) as Prisma.InputJsonValue,
      },
    });
    return taskCommentResponse(c);
  }

  async update(user: User, id: string, dto: UpdateTaskCommentDto) {
    const c = await this.ensureAccess(user, id);
    this.assertAuthor(user, c);
    const data: Prisma.TaskCommentUpdateInput = {};
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.mentions !== undefined) data.mentions = dto.mentions as Prisma.InputJsonValue;
    if (dto.attachments !== undefined) data.attachments = dto.attachments as Prisma.InputJsonValue;
    return taskCommentResponse(await this.prisma.taskComment.update({ where: { id: c.id }, data }));
  }

  async remove(user: User, id: string): Promise<void> {
    const c = await this.ensureAccess(user, id);
    this.assertAuthor(user, c);
    await this.prisma.taskComment.delete({ where: { id: c.id } });
  }

  private async ensureAccess(
    user: User,
    id: string,
  ): Promise<{ id: string; taskId: string; userId: string }> {
    const c = await this.prisma.taskComment.findUnique({
      where: { id },
      select: { id: true, taskId: true, userId: true },
    });
    if (!c) throw new NotFoundException('Not found.');
    await this.assertTaskAccess(user, c.taskId);
    return c;
  }

  /**
   * Editing or deleting a comment is the AUTHOR's right alone.
   *
   * Seeing the parent task is not enough: `ensureAccess` only proves the caller
   * is in the workspace, so without this any member could rewrite or delete
   * anyone else's comment through the API. The UI has always hidden those
   * controls for other people's comments — this makes the server agree, rather
   * than trusting a client that an attacker does not have to use.
   */
  private assertAuthor(user: User, comment: { userId: string }): void {
    if (this.access.isPlatformAdmin(user)) return;
    if (comment.userId !== user.id) {
      throw new ForbiddenException('You can only change your own comments.');
    }
  }

  /** Resolve the task's workspace and require the caller to be a member (else 404). */
  private async assertTaskAccess(user: User, taskId: string): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (!task || !(await this.access.activeMembership(user.id, task.workspaceId))) {
      throw new NotFoundException('Not found.');
    }
  }
}

@Injectable()
export class KanbanColumnsService {
  private readonly spec: ListQuerySpec = {
    filterable: { projectId: { field: 'projectId' }, status: { field: 'status' } },
    sortable: { createdAt: 'createdAt', position: 'position' },
    defaultOrderBy: { position: 'asc' },
  };
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof kanbanColumnResponse>>> {
    const projectId = typeof query.projectId === 'string' ? query.projectId : undefined;
    if (!projectId) throw new NotFoundException('Not found.');
    await this.assertProjectAccess(user, projectId);
    const parsed = parseListQuery(query, this.spec);
    const where = parsed.where as Prisma.KanbanColumnWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.kanbanColumn.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.KanbanColumnOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.kanbanColumn.count({ where }),
    ]);
    return paginate(items.map(kanbanColumnResponse), total, parsed.page, parsed.pageSize);
  }

  async retrieve(user: User, id: string) {
    const k = await this.prisma.kanbanColumn.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('Not found.');
    await this.assertProjectAccess(user, k.projectId);
    return kanbanColumnResponse(k);
  }

  async create(user: User, dto: CreateKanbanColumnDto) {
    await this.assertProjectAccess(user, dto.projectId);
    const k = await this.prisma.kanbanColumn.create({
      data: {
        id: generateId(),
        projectId: dto.projectId,
        name: dto.name,
        status: dto.status,
        wipLimit: dto.wipLimit ?? null,
        position: dto.position ?? 0,
        color: dto.color ?? '',
      },
    });
    return kanbanColumnResponse(k);
  }

  async update(user: User, id: string, dto: UpdateKanbanColumnDto) {
    const k = await this.ensureAccess(user, id);
    const data: Prisma.KanbanColumnUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.wipLimit !== undefined) data.wipLimit = dto.wipLimit;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.color !== undefined) data.color = dto.color;
    return kanbanColumnResponse(await this.prisma.kanbanColumn.update({ where: { id: k.id }, data }));
  }

  async remove(user: User, id: string): Promise<void> {
    const k = await this.ensureAccess(user, id);
    await this.prisma.kanbanColumn.delete({ where: { id: k.id } });
  }

  private async ensureAccess(user: User, id: string): Promise<{ id: string; projectId: string }> {
    const k = await this.prisma.kanbanColumn.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!k) throw new NotFoundException('Not found.');
    await this.assertProjectAccess(user, k.projectId);
    return k;
  }

  /** Resolve the project's workspace and require the caller to be a member (else 404). */
  private async assertProjectAccess(user: User, projectId: string): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project || !(await this.access.activeMembership(user.id, project.workspaceId))) {
      throw new NotFoundException('Not found.');
    }
  }
}
