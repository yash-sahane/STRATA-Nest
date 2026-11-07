import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Notification, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { DENY_MESSAGE, WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type { CreateNotificationDto, UpdateNotificationDto } from './dto';
import { NotificationPreferencesService } from './notification-preferences.service';
import { notificationResponse } from './mappers';

/** Fields the server/subscriber supplies to create a notification. */
export interface NotificationInput {
  workspaceId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  projectId?: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
}

@Injectable()
export class NotificationsService extends ScopedCrudService<
  Notification,
  ReturnType<typeof notificationResponse>
> {
  protected readonly model = 'notification';
  protected readonly writePermission: PermissionKey = Permission.NotificationWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' }, // server-forced in `list`, never taken from the caller
      type: { field: 'type' },
      isRead: { field: 'isRead', type: 'boolean' },
      projectId: { field: 'projectId' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly preferences: NotificationPreferencesService,
  ) {
    super(prisma, access);
  }
  protected map(row: Notification) {
    return notificationResponse(row);
  }

  /** The collection is recipient-only for the same reason `findScoped` is: the
   *  workspace scope alone let any member read every other member's feed
   *  (leave decisions, mentions, …) via `?userId=<victim>`. Every caller-supplied
   *  `userId` filter is dropped and the recipient forced, so the query string can
   *  only ever narrow the set. */
  override list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof notificationResponse>>> {
    if (this.access.isPlatformAdmin(user)) return super.list(user, query);
    const scoped: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key === 'userId' || key.startsWith('userId__')) continue;
      scoped[key] = value;
    }
    return super.list(user, { ...scoped, userId: user.id });
  }

  /**
   * A notification is its recipient's, wherever it came from.
   *
   * The base scope is "rows in workspaces you are an active member of". For an
   * inbox that is the wrong question: the three things a person most needs
   * telling — that they were removed from a workspace, that their access to it
   * was switched off, that their request to join it was declined — are all
   * filed under a workspace they cannot see into. They were written, and never
   * once read. Every read and write below is by recipient instead; a platform
   * admin keeps the wide read for support.
   */
  protected override async readScope(user: User): Promise<Record<string, unknown>> {
    if (this.access.isPlatformAdmin(user)) return super.readScope(user);
    return { userId: user.id };
  }

  /** A notification is user-owned: another member's notification 404s exactly
   *  like an out-of-workspace id, so retrieve/update/remove are recipient-only. */
  protected override async findScoped(user: User, id: string): Promise<Notification> {
    const row = await super.findScoped(user, id);
    if (!this.access.isPlatformAdmin(user) && row.userId !== user.id) {
      throw new NotFoundException('Not found.');
    }
    return row;
  }

  /**
   * A caller may write a notification to THEMSELVES, and to nobody else.
   *
   * This endpoint used to be how every work notification was made: the acting
   * user's browser POSTed one per recipient, so it had to accept `userId` for
   * anybody — and with `notification:write` in every member's baseline, any
   * member could put "Leave approved" (or anything else) in any colleague's
   * inbox. Those notifications are written by the server now, from the events
   * the services emit (WorkNotificationSubscriber), so nothing legitimate is
   * left that needs to address somebody else, and nothing in the app writes here
   * any more. Platform admins are exempt, for seeding and support.
   *
   * The recipient's opt-out is still honoured here: a muted type is dropped
   * silently (`null` → empty body), with the write permission still asserted so
   * an unauthorized caller gets 403 rather than a misleading success.
   */
  async create(user: User, dto: CreateNotificationDto) {
    if (dto.userId !== user.id && !this.access.isPlatformAdmin(user)) {
      throw new ForbiddenException(DENY_MESSAGE);
    }
    if (!(await this.preferences.allows(dto.workspaceId, dto.userId, dto.type, 'inApp'))) {
      await this.access.assertPermission(user, dto.workspaceId, this.writePermission);
      return null;
    }
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      projectId: dto.projectId ?? '',
      relatedEntityId: dto.relatedEntityId ?? '',
      relatedEntityType: dto.relatedEntityType ?? '',
      isRead: dto.isRead ?? false,
    });
  }

  async patch(user: User, id: string, dto: UpdateNotificationDto) {
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.message !== undefined) data.message = dto.message;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.projectId !== undefined) data.projectId = dto.projectId;
    if (dto.relatedEntityId !== undefined) data.relatedEntityId = dto.relatedEntityId;
    if (dto.relatedEntityType !== undefined) data.relatedEntityType = dto.relatedEntityType;
    if (dto.isRead !== undefined) data.isRead = dto.isRead;
    /**
     * Marking a notice read is the recipient's to do, whatever has become of
     * their place in the workspace it came from.
     *
     * `update` asks for `notification:write` in the notice's workspace. For
     * somebody who has just been removed from that workspace — the subject of
     * the notice — that is a permission they no longer hold: they could read
     * "you were removed" and never get it out of their unread count.
     * `findScoped` already limits this to the recipient.
     */
    const fields = Object.keys(data);
    if (fields.length === 1 && fields[0] === 'isRead') {
      const row = await this.findScoped(user, id);
      return this.map(await this.prisma.notification.update({ where: { id: row.id }, data }));
    }
    return this.update(user, id, data);
  }

  /** Discarding one is the recipient's to do as well, for the same reason. */
  override async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    await this.prisma.notification.delete({ where: { id: row.id } });
  }

  /** POST notifications/mark_all_read — mark all of the caller's unread as read. */
  /**
   * Delete every notification of the caller in one statement.
   *
   * The browser used to fan out one DELETE per row and then let each write's
   * realtime echo re-invalidate both notification queries, so clearing a full
   * inbox cost 50 DELETEs plus a refetch storm. Scoped to `userId` so it can
   * only ever clear the caller's own.
   */
  async removeAll(user: User): Promise<{ deleted: number }> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { userId: user.id },
    });
    if (count) this.prisma.announceWrite?.('Notification', 'delete', { id: '*', userId: user.id });
    return { deleted: count };
  }

  async markAllRead(user: User): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    if (count) this.prisma.announceWrite?.('Notification', 'update', { id: '*', userId: user.id });
    return { updated: count };
  }

  /**
   * Server-guaranteed creation used by NotificationSubscriber. Writes the in-app
   * Notification the frontend reads AND its `in_app` delivery row (the
   * Notification→NotificationDelivery split; email/push delivery is handled
   * separately). Best-effort: a subscriber must never fail the originating
   * transaction. Honours the recipient's in-app opt-out for the type.
   */
  async deliver(input: NotificationInput): Promise<void> {
    if (!(await this.preferences.allows(input.workspaceId, input.userId, input.type, 'inApp'))) {
      return;
    }
    await this.prisma.notification.create({
      data: {
        id: generateId(),
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        projectId: input.projectId ?? '',
        relatedEntityId: input.relatedEntityId ?? '',
        relatedEntityType: input.relatedEntityType ?? '',
      },
    });
  }
}
