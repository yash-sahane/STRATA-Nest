import { toDjangoIso } from '@lt/common';
import type { Notification } from '@prisma/client';

/**
 * Django NotificationSerializer field order. NativeModelSerializer pops
 * created_at/updated_at and re-adds them → they serialize LAST (A§core), so
 * createdAt/updatedAt are appended after isRead here to match byte-for-byte.
 */
export function notificationResponse(n: Notification) {
  return {
    id: String(n.id),
    workspaceId: n.workspaceId,
    userId: n.userId,
    type: n.type,
    title: n.title,
    message: n.message,
    projectId: n.projectId,
    relatedEntityId: n.relatedEntityId,
    relatedEntityType: n.relatedEntityType,
    isRead: n.isRead,
    createdAt: toDjangoIso(n.createdAt),
    updatedAt: toDjangoIso(n.updatedAt),
  };
}
