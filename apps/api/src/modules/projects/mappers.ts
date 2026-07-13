import { formatApiTimestamp } from '@strata/common';
import type { Project } from '@prisma/client';

/** Date fields serialize as date-only "YYYY-MM-DD" on the wire. */
const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Field order matches the API's frozen Project contract (createdAt/updatedAt last). */
export function projectResponse(p: Project) {
  return {
    id: String(p.id),
    workspaceId: p.workspaceId,
    name: p.name,
    shortCode: p.shortCode,
    description: p.description,
    clientName: p.clientName,
    logo: p.logo,
    color: p.color,
    methodology: p.methodology,
    status: p.status,
    archived: p.archived,
    startDate: dateOnly(p.startDate),
    endDate: dateOnly(p.endDate),
    ownerId: p.ownerId,
    createdBy: p.createdById,
    createdByName: p.createdByName,
    memberIds: p.memberIds,
    settings: p.projectSettings,
    createdAt: formatApiTimestamp(p.createdAt),
    updatedAt: formatApiTimestamp(p.updatedAt),
  };
}
