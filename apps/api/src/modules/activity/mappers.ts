import { formatApiTimestamp } from '@strata/common';
import type { ActivityLog, Prisma } from '@prisma/client';

const asJson = (v: Prisma.JsonValue): unknown => v ?? {};

/** The API's ActivityLog field order (createdAt/updatedAt appended last). */
export function activityLogResponse(a: ActivityLog) {
  return {
    id: String(a.id),
    workspaceId: a.workspaceId,
    userId: a.userId,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    changes: asJson(a.changes),
    metadata: asJson(a.metadata),
    createdAt: formatApiTimestamp(a.createdAt),
    updatedAt: formatApiTimestamp(a.updatedAt),
  };
}
