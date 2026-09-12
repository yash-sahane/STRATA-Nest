import { formatApiTimestamp } from '@strata/common';
import type { Notification, NotificationPreference } from '@prisma/client';

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

/** A per-user delivery preference. Same ordering convention as above. */
export function notificationPreferenceResponse(p: NotificationPreference) {
  return {
    id: String(p.id),
    workspaceId: p.workspaceId,
    userId: p.userId,
    type: p.type,
    inApp: p.inApp,
    email: p.email,
    createdAt: formatApiTimestamp(p.createdAt),
    updatedAt: formatApiTimestamp(p.updatedAt),
  };
}
