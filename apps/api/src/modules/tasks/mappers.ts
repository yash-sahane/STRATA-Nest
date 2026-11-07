import { formatApiTimestamp } from '@strata/common';
import type { Task, TaskComment } from '@prisma/client';

const isoOrNull = (d: Date | null): string | null => (d ? formatApiTimestamp(d) : null);

/** Field order matches the API's frozen Task contract (createdAt/updatedAt last). */
export function taskResponse(t: Task) {
  return {
    id: String(t.id),
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    hierarchyId: t.hierarchyId,
    sprintId: t.sprintId,
    epicId: t.epicId,
    functionalRequirementId: t.functionalRequirementId,
    parentTaskId: t.parentTaskId,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigneeIds: t.assigneeIds,
    assigneeNames: t.assigneeNames,
    assignedBy: t.assignedBy,
    assignedByName: t.assignedByName,
    createdBy: t.createdById,
    createdByName: t.createdByName,
    dueDate: isoOrNull(t.dueDate),
    estimatedHours: t.estimatedHours,
    labels: t.labels,
    position: t.position,
    blockedBy: t.blockedBy,
    blocks: t.blocks,
    completedAt: isoOrNull(t.completedAt),
    createdAt: formatApiTimestamp(t.createdAt),
    updatedAt: formatApiTimestamp(t.updatedAt),
  };
}

export function taskCommentResponse(c: TaskComment) {
  return {
    id: String(c.id),
    taskId: c.taskId,
    userId: c.userId,
    content: c.content,
    mentions: c.mentions,
    createdAt: formatApiTimestamp(c.createdAt),
    updatedAt: formatApiTimestamp(c.updatedAt),
  };
}
