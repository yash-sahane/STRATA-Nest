import { toDjangoIso } from '@lt/common';
import type { Project } from '@prisma/client';

/** Django DateField → date-only "YYYY-MM-DD" on the wire (A§6.2). */
const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Field order mirrors the Django ProjectSerializer (createdAt/updatedAt last). */
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
    createdAt: toDjangoIso(p.createdAt),
    updatedAt: toDjangoIso(p.updatedAt),
  };
}
