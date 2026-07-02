import { toDjangoIso } from '@lt/common';
import type { Retrospective, Sprint } from '@prisma/client';

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Field order mirrors the Django SprintSerializer (createdAt/updatedAt last). */
export function sprintResponse(s: Sprint) {
  return {
    id: String(s.id),
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    name: s.name,
    goal: s.goal,
    startDate: dateOnly(s.startDate),
    endDate: dateOnly(s.endDate),
    status: s.status,
    retrospectiveNotes: s.retrospectiveNotes,
    createdBy: s.createdById,
    createdByName: s.createdByName,
    createdAt: toDjangoIso(s.createdAt),
    updatedAt: toDjangoIso(s.updatedAt),
  };
}

/** RetrospectiveSerializer has no createdByName (model has no such field). */
export function retrospectiveResponse(r: Retrospective) {
  return {
    id: String(r.id),
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    sprintId: r.sprintId,
    wentWell: r.wentWell,
    needsImprovement: r.needsImprovement,
    actionItems: r.actionItems,
    createdBy: r.createdById,
    createdAt: toDjangoIso(r.createdAt),
    updatedAt: toDjangoIso(r.updatedAt),
  };
}
