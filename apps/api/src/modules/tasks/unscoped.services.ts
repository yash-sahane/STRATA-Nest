import { Injectable, NotFoundException } from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@lt/common';
import type { PaginatedResponse } from '@lt/shared';
import { PrismaService } from '@lt/prisma';
import type { KanbanColumn, Prisma, TaskComment, User } from '@prisma/client';
import type {
  CreateKanbanColumnDto,
  CreateTaskCommentDto,
  UpdateKanbanColumnDto,
  UpdateTaskCommentDto,
} from './dto';
import { kanbanColumnResponse, taskCommentResponse } from './mappers';

/**
 * TaskComment / KanbanColumn have NO workspace column in Django, so the base
 * viewset does NOT workspace-scope them — any authenticated user. Reproduced
 * faithfully (pre-existing gap; the frontend always filters by taskId/projectId).
 */
@Injectable()
export class TaskCommentsService {
  private readonly spec: ListQuerySpec = {
    filterable: { taskId: { field: 'taskId' }, userId: { field: 'userId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof taskCommentResponse>>> {
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

  async retrieve(id: string) {
    const c = await this.prisma.taskComment.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Not found.');
    return taskCommentResponse(c);
  }

  async create(user: User, dto: CreateTaskCommentDto) {
    const c = await this.prisma.taskComment.create({
      data: {
        id: generateId(),
        taskId: dto.taskId,
        userId: user.id, // Django perform_create sets user = caller
        content: dto.content,
        mentions: (dto.mentions ?? []) as Prisma.InputJsonValue,
        attachments: (dto.attachments ?? []) as Prisma.InputJsonValue,
      },
    });
    return taskCommentResponse(c);
  }

  async update(id: string, dto: UpdateTaskCommentDto) {
    await this.ensure(id);
    const data: Prisma.TaskCommentUpdateInput = {};
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.mentions !== undefined) data.mentions = dto.mentions as Prisma.InputJsonValue;
    if (dto.attachments !== undefined) data.attachments = dto.attachments as Prisma.InputJsonValue;
    return taskCommentResponse(await this.prisma.taskComment.update({ where: { id }, data }));
  }

  async remove(id: string): Promise<void> {
    await this.ensure(id);
    await this.prisma.taskComment.delete({ where: { id } });
  }

  private async ensure(id: string): Promise<void> {
    if (!(await this.prisma.taskComment.findUnique({ where: { id }, select: { id: true } }))) {
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
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof kanbanColumnResponse>>> {
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

  async retrieve(id: string) {
    const k = await this.prisma.kanbanColumn.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('Not found.');
    return kanbanColumnResponse(k);
  }

  async create(dto: CreateKanbanColumnDto) {
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

  async update(id: string, dto: UpdateKanbanColumnDto) {
    await this.ensure(id);
    const data: Prisma.KanbanColumnUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.wipLimit !== undefined) data.wipLimit = dto.wipLimit;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.color !== undefined) data.color = dto.color;
    return kanbanColumnResponse(await this.prisma.kanbanColumn.update({ where: { id }, data }));
  }

  async remove(id: string): Promise<void> {
    await this.ensure(id);
    await this.prisma.kanbanColumn.delete({ where: { id } });
  }

  private async ensure(id: string): Promise<void> {
    if (!(await this.prisma.kanbanColumn.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException('Not found.');
    }
  }
}
