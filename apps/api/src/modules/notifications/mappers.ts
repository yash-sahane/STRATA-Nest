import { formatApiTimestamp } from '@strata/common';
import type { Notification } from '@prisma/client';

/**
 * The API's Notification field order. createdAt/updatedAt must serialize LAST in
 * the JSON, so they are appended after isRead here to match the frozen contract.
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
    createdAt: formatApiTimestamp(n.createdAt),
    updatedAt: formatApiTimestamp(n.updatedAt),
  };
}
