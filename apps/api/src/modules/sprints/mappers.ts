import { formatApiTimestamp } from '@strata/common';
import type { Sprint } from '@prisma/client';

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Field order matches the API's frozen Sprint contract (createdAt/updatedAt last). */
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
    // The figures as they stood when the sprint was closed. Null on a sprint
    // completed before these were recorded — the UI says "not recorded" rather
    // than substituting a number nobody measured.
    completedAt: s.completedAt ? formatApiTimestamp(s.completedAt) : null,
    completedTaskCount: s.completedTaskCount,
    totalTaskCount: s.totalTaskCount,
    rolledOverTaskCount: s.rolledOverTaskCount,
    createdBy: s.createdById,
    createdByName: s.createdByName,
    createdAt: formatApiTimestamp(s.createdAt),
    updatedAt: formatApiTimestamp(s.updatedAt),
  };
}
