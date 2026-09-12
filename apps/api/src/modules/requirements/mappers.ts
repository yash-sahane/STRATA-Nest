import { formatApiTimestamp } from '@strata/common';
import type { ClientRequirement, FunctionalRequirement } from '@prisma/client';

/** Field order matches the API's frozen contract (createdAt/updatedAt appended last). */

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
    createdAt: formatApiTimestamp(r.createdAt),
    updatedAt: formatApiTimestamp(r.updatedAt),
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
    parentRequirementId: r.parentRequirementId,
    title: r.title,
    description: r.description,
    type: r.type,
    complexity: r.complexity,
    priority: r.priority,
    status: r.status,
    progress: r.progress,
    reusable: r.reusable,
    assignedTo: r.assignedTo,
    assignedToNames: r.assignedToNames,
    // These fields are serialized as CSV strings on the wire (frozen contract).
    tags: r.tags,
    linkedProjectIds: r.linkedProjectIds,
    createdBy: r.createdById,
    createdByName: r.createdByName,
    createdAt: formatApiTimestamp(r.createdAt),
    updatedAt: formatApiTimestamp(r.updatedAt),
  };
}
