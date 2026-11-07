import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  generateId,
  paginate,
  parseListQuery,
  pinScopeParam,
  requiredScopeParam,
  type ListQuerySpec,
} from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { Permission } from '../authz/permissions';
import type { CreateTaskCommentDto, UpdateTaskCommentDto } from './dto';
import { taskCommentResponse } from './mappers';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { tellPeople } from '../notifications/notice';
import { assertTaskProjectWritable } from '../projects/project-archive';

/**
 * A TaskComment has no workspace column of its own; it is scoped through its
 * parent Task. Every read/write of a single record verifies the caller is a
 * member of the task's workspace, so no one can read, edit, or delete another
 * workspace's comment by guessing its id.
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
    private readonly events?: EventEmitter2,
  ) {}

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof taskCommentResponse>>> {
    // Scoped read path: a caller must name the parent task and be a member of
    // its workspace. (An unfiltered cross-workspace listing is intentionally
    // not offered here.)
    // requiredScopeParam, not a typeof check. Express turns a repeated parameter
    // into an array, so ?taskId=A&taskId=A failed the `typeof === 'string'` test
    // and fell through to NotFound — the caller HAD named the task, just twice,
    // and was told it does not exist. A missing value is now a 400, which is what
    // a malformed request deserves.
    const taskId = requiredScopeParam(query.taskId, 'taskId');
    await this.assertTaskAccess(user, taskId);
    // TaskComment has no workspace column, so the task the caller was just
    // authorised against is the ONLY scope this list has. It is pinned, not
    // read back out of the query: `?taskId=<mine>&taskId__ne=x` used to pass the
    // check on one task and then filter by `{ not: 'x' }` — every comment in
    // every tenant.
    const parsed = parseListQuery(pinScopeParam(query, 'taskId', taskId), this.spec);
    const where: Prisma.TaskCommentWhereInput = {
      AND: [{ taskId }, parsed.where as Prisma.TaskCommentWhereInput],
    };
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
    // A comment is part of the task, and an archived project's tasks do not
    // change — see project-archive. So with edits and takedowns below.
    await assertTaskProjectWritable(this.prisma, dto.taskId);
    const c = await this.prisma.taskComment.create({
      data: {
        id: generateId(),
        taskId: dto.taskId,
        userId: user.id, // stamped from the caller
        content: dto.content,
        mentions: (dto.mentions ?? []) as Prisma.InputJsonValue,
      },
    });
    await this.announceComment(user, dto.taskId);
    return taskCommentResponse(c);
  }

  /**
   * A comment is said TO somebody: the people doing the task, and whoever
   * raised it. It used to be said to nobody — it sat under the task until one
   * of them happened to open it.
   */
  private async announceComment(author: User, taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        workspaceId: true,
        projectId: true,
        title: true,
        hierarchyId: true,
        assigneeIds: true,
        createdById: true,
      },
    });
    if (!task) return;
    const assignees = Array.isArray(task.assigneeIds) ? (task.assigneeIds as string[]) : [];
    tellPeople(this.events, {
      workspaceId: task.workspaceId,
      recipients: [...assignees, task.createdById].filter((id): id is string => Boolean(id)),
      actorId: author.id,
      type: 'TASK_COMMENT_ADDED',
      title: `New comment: ${task.title}`,
      message: `${author.name || author.email} commented on "${task.title}" (${task.hierarchyId})`,
      projectId: task.projectId,
      relatedEntityId: taskId,
      relatedEntityType: 'TASK',
    });
  }

  async update(user: User, id: string, dto: UpdateTaskCommentDto) {
    const c = await this.ensureAccess(user, id);
    this.assertAuthor(user, c);
    await assertTaskProjectWritable(this.prisma, c.taskId);
    const data: Prisma.TaskCommentUpdateInput = {};
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.mentions !== undefined) data.mentions = dto.mentions as Prisma.InputJsonValue;
    return taskCommentResponse(await this.prisma.taskComment.update({ where: { id: c.id }, data }));
  }

  /**
   * Its author deletes a comment — and so may whoever may delete tasks in the
   * workspace (task:write), or a comment nobody else could take down stayed up
   * whatever it said. Not edit: rewriting somebody's words under their name is
   * worse than removing them. The author is told who removed it.
   */
  async remove(user: User, id: string): Promise<void> {
    const c = await this.ensureAccess(user, id);
    const byAuthor = c.userId === user.id;
    const task = byAuthor
      ? null
      : await this.prisma.task.findUnique({
          where: { id: c.taskId },
          select: { workspaceId: true, projectId: true, title: true, hierarchyId: true },
        });
    if (!byAuthor && !this.access.isPlatformAdmin(user)) {
      if (!task || !(await this.access.can(user, task.workspaceId, Permission.TaskWrite))) {
        throw new ForbiddenException('You can only delete your own comments.');
      }
    }
    await assertTaskProjectWritable(this.prisma, c.taskId);
    await this.prisma.taskComment.delete({ where: { id: c.id } });
    if (task) {
      tellPeople(this.events, {
        workspaceId: task.workspaceId,
        recipients: [c.userId],
        actorId: user.id,
        type: 'TASK_COMMENT_REMOVED',
        title: `Comment removed: ${task.title}`,
        message: `${user.name || user.email} removed your comment on "${task.title}" (${task.hierarchyId}).`,
        projectId: task.projectId,
        relatedEntityId: c.taskId,
        relatedEntityType: 'TASK',
      });
    }
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
   * Editing a comment is the AUTHOR's right alone (deleting one, see `remove`).
   *
   * Seeing the parent task is not enough: `ensureAccess` only proves the caller
   * is in the workspace, so without this any member could rewrite or delete
   * anyone else's comment through the API. The UI has always hidden those
   * controls for other people's comments — this makes the server agree, rather
   * than trusting a client that an attacker does not have to use.
   *
   * A platform admin included. They were let through here, which put words in
   * somebody else's mouth under that person's name — the thing `remove` gives
   * as its reason for allowing a takedown but not an edit. An admin who must
   * act on a comment deletes it, and its author is told who did.
   */
  private assertAuthor(user: User, comment: { userId: string }): void {
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
