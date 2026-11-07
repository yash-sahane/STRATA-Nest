import type { ClientRequirement, FunctionalRequirement } from '@prisma/client';
import { clientRequirementResponse, functionalRequirementResponse } from './mappers';

const base = {
  createdAt: new Date('2026-06-30T12:34:56.789Z'),
  updatedAt: new Date('2026-06-30T12:34:56.789Z'),
  // On the row but deliberately NOT in the response: the lost-update check compares
  // fields, not row versions, so no client ever sends this back. It is here because the
  // Prisma type has it, not because the mapper should.
  version: 0,
  workspaceId: 'w1',
  projectId: 'p1',
  createdById: 'u1',
  createdByName: 'U',
};

describe('clientRequirementResponse', () => {
  it('preserves the fixed field order + microsecond timestamps', () => {
    const r = clientRequirementResponse({
      id: 'cr1',
      title: 'T',
      description: '',
      clientName: 'Acme',
      priority: 'HIGH',
      status: 'DRAFT',
      ...base,
    } as ClientRequirement);
    expect(r.createdBy).toBe('u1');
    expect(r.createdAt).toBe('2026-06-30T12:34:56.789000Z');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'title', 'description', 'clientName', 'priority',
      'status', 'createdBy', 'createdByName', 'createdAt', 'updatedAt',
    ]);
  });
});

describe('functionalRequirementResponse', () => {
  it('carries the assignee list with its names, and preserves field order', () => {
    const r = functionalRequirementResponse({
      id: 'fr1',
      hierarchyId: 'PRJ-CR-EP-FR-01',
      epicId: '',
      sprintId: '',
      clientRequirementId: 'cr1',
      parentRequirementId: '',
      title: 'T',
      description: '',
      type: 'FUNCTIONAL',
      complexity: 'MEDIUM',
      priority: '',
      status: 'DRAFT',
      progress: 0,
      assigneeIds: ['u1'],
      assigneeNames: ['U'],
      ...base,
    } as FunctionalRequirement);
    expect(r.assigneeIds).toEqual(['u1']);
    expect(r.assigneeNames).toEqual(['U']);
    expect(r.createdBy).toBe('u1');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'hierarchyId', 'epicId', 'sprintId',
      'clientRequirementId', 'parentRequirementId', 'title', 'description', 'type',
      'complexity', 'priority', 'status',
      'progress', 'assigneeIds', 'assigneeNames',
      'createdBy', 'createdByName', 'createdAt', 'updatedAt',
    ]);
  });
});
