import type { Task } from '@prisma/client';
import { taskResponse } from './mappers';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    createdAt: new Date('2026-06-30T12:34:56.789Z'),
    updatedAt: new Date('2026-06-30T12:34:56.789Z'),
    workspaceId: 'w1',
    projectId: 'p1',
    hierarchyId: 'PRJ-TSK-01',
    sprintId: '',
    epicId: '',
    functionalRequirementId: '',
    parentTaskId: '',
    title: 'T',
    description: '',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    assigneeIds: ['u1'],
    assignedBy: '',
    assignedByName: '',
    assignedTo: [],
    assignedToNames: [],
    watcherIds: [],
    createdById: 'u1',
    createdByName: 'U',
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    labels: ['lbl1'],
    attachments: [],
    customFields: {},
    position: 0,
    blockedBy: [],
    blocks: [],
    ...over,
  } as Task;
}

describe('taskResponse', () => {
  it('keeps JSON fields as arrays, maps createdBy, and preserves the 30-field order', () => {
    const r = taskResponse(task({ dueDate: new Date('2026-07-01T09:00:00.000Z') }));
    expect(r.labels).toEqual(['lbl1']);
    expect(r.assigneeIds).toEqual(['u1']);
    expect(r.blockedBy).toEqual([]);
    expect(r.createdBy).toBe('u1');
    expect(r.dueDate).toBe('2026-07-01T09:00:00.000000Z');
    expect(r.createdAt).toBe('2026-06-30T12:34:56.789000Z');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'hierarchyId', 'sprintId', 'epicId',
      'functionalRequirementId', 'parentTaskId', 'title', 'description', 'status', 'priority',
      'assigneeIds', 'assignedBy', 'assignedByName', 'assignedTo', 'assignedToNames', 'watcherIds',
      'createdBy', 'createdByName', 'dueDate', 'estimatedHours', 'actualHours', 'labels',
      'attachments', 'customFields', 'position', 'blockedBy', 'blocks', 'createdAt', 'updatedAt',
    ]);
  });

  it('emits null for unset dueDate', () => {
    expect(taskResponse(task()).dueDate).toBeNull();
  });
});
