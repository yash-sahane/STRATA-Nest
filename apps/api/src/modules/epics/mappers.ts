import { toDjangoIso } from '@lt/common';
import type { Epic } from '@prisma/client';

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Field order mirrors the Django EpicSerializer (createdAt/updatedAt last). */
export function epicResponse(e: Epic) {
  return {
    id: String(e.id),
    workspaceId: e.workspaceId,
    projectId: e.projectId,
    requirementId: e.requirementId,
    hierarchyId: e.hierarchyId,
    name: e.name,
    description: e.description,
    color: e.color,
    startDate: dateOnly(e.startDate),
    endDate: dateOnly(e.endDate),
    status: e.status,
    progress: e.progress,
    assignedTeam: e.assignedTeam,
    createdBy: e.createdById,
    createdByName: e.createdByName,
    createdAt: toDjangoIso(e.createdAt),
    updatedAt: toDjangoIso(e.updatedAt),
  };
}
