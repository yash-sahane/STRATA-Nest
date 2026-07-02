import { toDjangoIso } from '@lt/common';
import type { ClientRequirement, FunctionalRequirement } from '@prisma/client';

/** Field order mirrors the Django serializers (createdAt/updatedAt appended last). */

export function clientRequirementResponse(r: ClientRequirement) {
  return {
    id: String(r.id),
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    title: r.title,
    description: r.description,
    clientName: r.clientName,
    priority: r.priority,
    status: r.status,
    attachments: r.attachments,
    createdBy: r.createdById,
    createdByName: r.createdByName,
    createdAt: toDjangoIso(r.createdAt),
    updatedAt: toDjangoIso(r.updatedAt),
  };
}

export function functionalRequirementResponse(r: FunctionalRequirement) {
  return {
    id: String(r.id),
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    hierarchyId: r.hierarchyId,
    epicId: r.epicId,
    sprintId: r.sprintId,
    clientRequirementId: r.clientRequirementId,
    title: r.title,
    description: r.description,
    complexity: r.complexity,
    priority: r.priority,
    status: r.status,
    progress: r.progress,
    reusable: r.reusable,
    assignedTo: r.assignedTo,
    assignedToNames: r.assignedToNames,
    // Django serializes these TextFields AS STRINGS (CSV) — wire parity (ADR-0003).
    tags: r.tags,
    linkedProjectIds: r.linkedProjectIds,
    createdBy: r.createdById,
    createdByName: r.createdByName,
    createdAt: toDjangoIso(r.createdAt),
    updatedAt: toDjangoIso(r.updatedAt),
  };
}
