import { Injectable } from '@nestjs/common';
import { generateId, type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Notification, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type { CreateNotificationDto, UpdateNotificationDto } from './dto';
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
      userId: { field: 'userId' },
      type: { field: 'type' },
      isRead: { field: 'isRead', type: 'boolean' },
      projectId: { field: 'projectId' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Notification) {
    return notificationResponse(row);
  }

  create(user: User, dto: CreateNotificationDto) {
    // Notification creation does not stamp user from the caller — the target
    // userId comes from the payload (a notification is addressed to someone).
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

  patch(user: User, id: string, dto: UpdateNotificationDto) {
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.message !== undefined) data.message = dto.message;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.projectId !== undefined) data.projectId = dto.projectId;
    if (dto.relatedEntityId !== undefined) data.relatedEntityId = dto.relatedEntityId;
    if (dto.relatedEntityType !== undefined) data.relatedEntityType = dto.relatedEntityType;
    if (dto.isRead !== undefined) data.isRead = dto.isRead;
    return this.update(user, id, data);
  }

  /** POST notifications/mark_all_read — mark all of the caller's unread as read. */
  async markAllRead(user: User): Promise<{ updated: number }> {
    const scope = await this.access.scopeWhere(user, 'workspaceId');
    const { count } = await this.prisma.notification.updateMany({
      where: { AND: [scope, { userId: user.id, isRead: false }] },
      data: { isRead: true },
    });
    return { updated: count };
  }

  /**
   * Server-guaranteed creation used by NotificationSubscriber. Writes the in-app
   * Notification the frontend reads AND its `in_app` delivery row (the
   * Notification→NotificationDelivery split; email/push delivery is handled
   * separately). Best-effort: a subscriber must never fail the originating
   * transaction.
   */
  async deliver(input: NotificationInput): Promise<void> {
    const notification = await this.prisma.notification.create({
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
    await this.prisma.notificationDelivery.create({
      data: {
        id: generateId(),
        notificationId: notification.id,
        channel: 'in_app',
        status: 'delivered',
        deliveredAt: new Date(),
      },
    });
  }
}
