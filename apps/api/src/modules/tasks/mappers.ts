import { toDjangoIso } from '@lt/common';
import type { KanbanColumn, Label, Task, TaskComment } from '@prisma/client';

const isoOrNull = (d: Date | null): string | null => (d ? toDjangoIso(d) : null);

/** Field order mirrors the Django TaskSerializer (createdAt/updatedAt last). */
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
    assignedBy: t.assignedBy,
    assignedByName: t.assignedByName,
    assignedTo: t.assignedTo,
    assignedToNames: t.assignedToNames,
    watcherIds: t.watcherIds,
    createdBy: t.createdById,
    createdByName: t.createdByName,
    dueDate: isoOrNull(t.dueDate),
    estimatedHours: t.estimatedHours,
    actualHours: t.actualHours,
    labels: t.labels,
    attachments: t.attachments,
    customFields: t.customFields,
    position: t.position,
    blockedBy: t.blockedBy,
    blocks: t.blocks,
    createdAt: toDjangoIso(t.createdAt),
    updatedAt: toDjangoIso(t.updatedAt),
  };
}

export function taskCommentResponse(c: TaskComment) {
  return {
    id: String(c.id),
    taskId: c.taskId,
    userId: c.userId,
    content: c.content,
    mentions: c.mentions,
    attachments: c.attachments,
    createdAt: toDjangoIso(c.createdAt),
    updatedAt: toDjangoIso(c.updatedAt),
  };
}

export function kanbanColumnResponse(k: KanbanColumn) {
  return {
    id: String(k.id),
    projectId: k.projectId,
    name: k.name,
    status: k.status,
    wipLimit: k.wipLimit,
    position: k.position,
    color: k.color,
    createdAt: toDjangoIso(k.createdAt),
    updatedAt: toDjangoIso(k.updatedAt),
  };
}

export function labelResponse(l: Label) {
  return {
    id: String(l.id),
    workspaceId: l.workspaceId,
    projectId: l.projectId,
    name: l.name,
    color: l.color,
    description: l.description,
    createdAt: toDjangoIso(l.createdAt),
    updatedAt: toDjangoIso(l.updatedAt),
  };
}
