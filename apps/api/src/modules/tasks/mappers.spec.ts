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
    completedAt: null,
    assigneeIds: ['u1'],
    assignedBy: '',
    assignedByName: '',
    assigneeNames: [],
    createdById: 'u1',
    createdByName: 'U',
    dueDate: null,
    estimatedHours: null,
    labels: ['lbl1'],
    position: 0,
    blockedBy: [],
    blocks: [],
    ...over,
  } as Task;
}

describe('taskResponse', () => {
  it('keeps JSON fields as arrays, maps createdBy, and preserves the field order', () => {
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
      'assigneeIds', 'assigneeNames', 'assignedBy', 'assignedByName',
      'createdBy', 'createdByName', 'dueDate', 'estimatedHours', 'labels',
      'position', 'blockedBy', 'blocks', 'completedAt', 'createdAt',
      'updatedAt',
    ]);
  });

  it('emits null for unset dueDate', () => {
    expect(taskResponse(task()).dueDate).toBeNull();
  });

  it('exposes completedAt so trends can bucket on completion, not updatedAt', () => {
    expect(taskResponse(task()).completedAt).toBeNull();
    expect(
      taskResponse(task({ status: 'DONE', completedAt: new Date('2026-03-02T08:00:00.000Z') }))
        .completedAt,
    ).toBe('2026-03-02T08:00:00.000000Z');
  });
});
