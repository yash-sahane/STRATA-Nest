/**
 * Where in the app a notice is acted on, as a path on the frontend.
 *
 * The mail copy of a notice used to carry no link at all: "Accept or decline it
 * on your Workspaces page" arrived as text, to somebody who then had to find the
 * app, sign in and look for the page. The in-app bell already knows where each
 * notice belongs (navigationUrlFor in the frontend's notification-center.tsx);
 * this is the same table for the notices the server mails, and the two must
 * agree. An unknown notice goes to the dashboard rather than to nowhere.
 */
export interface NoticeTarget {
  type: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  projectId?: string | null;
}

export function appPathFor(notice: NoticeTarget): string {
  const type = (notice.type ?? '').trim().toUpperCase();
  const entity = (notice.relatedEntityType ?? '').trim().toUpperCase();
  const { relatedEntityId: id, projectId } = notice;

  if (type === 'LEAVE_REQUESTED' || type === 'LEAVE_CANCELLED') return '/leave?tab=team-leaves';
  if (type === 'TIME_ENTRY_SUBMITTED') return '/time-tracking?tab=approvals';

  if (entity === 'WORKSPACE') return '/workspaces';
  if (entity === 'JOIN_REQUEST') return type === 'JOIN_REQUEST_RECEIVED' ? '/team?tab=requests' : '/workspaces';
  if (entity === 'LEAVE_REQUEST') return '/leave';
  if (entity === 'TIME_ENTRY') return '/time-tracking';

  if (type.startsWith('TASK_') || type.startsWith('COMMENT_')) {
    if (projectId && id) return `/tasks?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(id)}`;
    return projectId ? `/tasks?projectId=${encodeURIComponent(projectId)}` : '/tasks';
  }
  if (type.startsWith('SPRINT_')) return id ? `/sprints/${encodeURIComponent(id)}/board` : '/sprints';
  if (type.startsWith('EPIC_')) return projectId ? `/epics?projectId=${encodeURIComponent(projectId)}` : '/epics';
  if (type.startsWith('FR_')) {
    return projectId ? `/functional-requirements?projectId=${encodeURIComponent(projectId)}` : '/functional-requirements';
  }
  if (type.startsWith('REQUIREMENT_')) {
    return projectId ? `/requirements?projectId=${encodeURIComponent(projectId)}` : '/requirements';
  }
  if (type === 'LEAVE_BALANCE_ADJUSTED') return '/leave?tab=balance';
  if (type.startsWith('LEAVE_')) return '/leave';
  if (type.startsWith('ATTENDANCE_')) return '/attendance';
  return '/dashboard';
}
