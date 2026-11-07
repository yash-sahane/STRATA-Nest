import { appPathFor } from './notice-links';

// The mail copy links to the same place the in-app bell opens (the frontend's
// navigationUrlFor). These are the notices the server actually mails.
describe('appPathFor', () => {
  it('sends an invitation, an add and a role change to the workspace list', () => {
    for (const type of ['WORKSPACE_INVITATION', 'WORKSPACE_MEMBER_ADDED', 'WORKSPACE_ROLE_CHANGED']) {
      expect(appPathFor({ type, relatedEntityType: 'workspace', relatedEntityId: 'w1' })).toBe('/workspaces');
    }
  });

  it('sends a request to join to the manager who decides it, and its answer to the requester', () => {
    expect(appPathFor({ type: 'JOIN_REQUEST_RECEIVED', relatedEntityType: 'join_request' })).toBe('/team?tab=requests');
    expect(appPathFor({ type: 'JOIN_REQUEST_APPROVED', relatedEntityType: 'join_request' })).toBe('/workspaces');
  });

  it('sends a leave request to the approvers queue, and a decision to the requester', () => {
    expect(appPathFor({ type: 'LEAVE_REQUESTED', relatedEntityType: 'leave_request' })).toBe('/leave?tab=team-leaves');
    expect(appPathFor({ type: 'LEAVE_APPROVED', relatedEntityType: 'leave_request' })).toBe('/leave');
  });

  it('sends time entries to approvals or to the person own list', () => {
    expect(appPathFor({ type: 'TIME_ENTRY_SUBMITTED', relatedEntityType: 'time_entry' })).toBe('/time-tracking?tab=approvals');
    expect(appPathFor({ type: 'TIME_ENTRY_REJECTED', relatedEntityType: 'time_entry' })).toBe('/time-tracking');
  });

  it('opens the task itself when it knows the task and its project', () => {
    expect(appPathFor({ type: 'TASK_DEADLINE_REMINDER', relatedEntityId: 't 1', projectId: 'p1' }))
      .toBe('/tasks?projectId=p1&taskId=t%201');
    expect(appPathFor({ type: 'TASK_ASSIGNED', projectId: 'p1' })).toBe('/tasks?projectId=p1');
    expect(appPathFor({ type: 'TASK_ASSIGNED' })).toBe('/tasks');
  });

  it('falls back to the dashboard rather than to nowhere', () => {
    expect(appPathFor({ type: 'SOMETHING_NEW' })).toBe('/dashboard');
    expect(appPathFor({ type: '' })).toBe('/dashboard');
  });
});
