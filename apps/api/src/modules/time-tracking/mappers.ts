import { formatApiTimestamp } from '@strata/common';
import type { ActiveTimer, TimeEntry } from '@prisma/client';

const isoOrNull = (d: Date | null): string | null => (d ? formatApiTimestamp(d) : null);

export function timeEntryResponse(t: TimeEntry) {
  return {
    id: String(t.id),
    workspaceId: t.workspaceId,
    userId: t.userId,
    userName: t.userName,
    userEmail: t.userEmail,
    createdBy: t.createdById,
    createdByName: t.createdByName,
    taskId: t.taskId,
    taskTitle: t.taskTitle,
    taskHierarchyId: t.taskHierarchyId,
    projectId: t.projectId,
    projectName: t.projectName,
    description: t.description,
    startTime: formatApiTimestamp(t.startTime),
    endTime: formatApiTimestamp(t.endTime),
    duration: t.duration,
    isBillable: t.isBillable,
    billableRate: t.billableRate,
    type: t.type,
    status: t.status,
    approvedBy: t.approvedBy,
    approvedAt: isoOrNull(t.approvedAt),
    rejectionReason: t.rejectionReason,
    tags: t.tags,
    createdAt: formatApiTimestamp(t.createdAt),
    updatedAt: formatApiTimestamp(t.updatedAt),
  };
}

export function activeTimerResponse(t: ActiveTimer) {
  return {
    id: String(t.id),
    userId: t.userId,
    taskId: t.taskId,
    taskTitle: t.taskTitle,
    taskHierarchyId: t.taskHierarchyId,
    projectId: t.projectId,
    description: t.description,
    startTime: formatApiTimestamp(t.startTime),
    isPaused: t.isPaused,
    pausedAt: isoOrNull(t.pausedAt),
    totalPausedTime: t.totalPausedTime,
    type: t.type,
    pomodoroSettings: t.pomodoroSettings,
    createdAt: formatApiTimestamp(t.createdAt),
    updatedAt: formatApiTimestamp(t.updatedAt),
  };
}
