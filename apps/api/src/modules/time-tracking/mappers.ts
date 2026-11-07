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
    status: t.status,
    approvedBy: t.approvedBy,
    approvedAt: isoOrNull(t.approvedAt),
    rejectionReason: t.rejectionReason,
    tags: t.tags,
    createdAt: formatApiTimestamp(t.createdAt),
    updatedAt: formatApiTimestamp(t.updatedAt),
  };
}

/**
 * What POST /active_timers/stop returns when the run was too short to log.
 *
 * `discarded` is the discriminator: a stop that DID write a row returns the
 * time entry, which carries no such field, so a client can branch on
 * `'discarded' in body` without a second request.
 */
export function discardedTimerResponse(minimumMinutes: number) {
  const unit = minimumMinutes === 1 ? 'a minute' : `${minimumMinutes} minutes`;
  return {
    discarded: true as const,
    minimumMinutes,
    message: `Timer discarded — it ran for less than ${unit}, so nothing was logged.`,
  };
}

export function activeTimerResponse(t: ActiveTimer) {
  return {
    id: String(t.id),
    userId: t.userId,
    workspaceId: t.workspaceId,
    taskId: t.taskId,
    taskTitle: t.taskTitle,
    taskHierarchyId: t.taskHierarchyId,
    projectId: t.projectId,
    description: t.description,
    startTime: formatApiTimestamp(t.startTime),
    isPaused: t.isPaused,
    pausedAt: isoOrNull(t.pausedAt),
    totalPausedTime: t.totalPausedTime,
    createdAt: formatApiTimestamp(t.createdAt),
    updatedAt: formatApiTimestamp(t.updatedAt),
  };
}
