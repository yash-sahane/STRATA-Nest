import { toDjangoIso } from '@lt/common';
import type { ActivityLog, Prisma, SavedSearch } from '@prisma/client';

const asJson = (v: Prisma.JsonValue): unknown => v ?? {};

/** Django ActivityLogSerializer order (createdAt/updatedAt appended last). */
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
    createdAt: toDjangoIso(a.createdAt),
    updatedAt: toDjangoIso(a.updatedAt),
  };
}

/** Django SavedSearchSerializer order (createdAt/updatedAt appended last). */
export function savedSearchResponse(s: SavedSearch) {
  return {
    id: String(s.id),
    workspaceId: s.workspaceId,
    userId: s.userId,
    name: s.name,
    query: s.query,
    filters: asJson(s.filters),
    createdAt: toDjangoIso(s.createdAt),
    updatedAt: toDjangoIso(s.updatedAt),
  };
}
