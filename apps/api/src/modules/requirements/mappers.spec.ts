import type { ClientRequirement, FunctionalRequirement } from '@prisma/client';
import { clientRequirementResponse, functionalRequirementResponse } from './mappers';

const base = {
  createdAt: new Date('2026-06-30T12:34:56.789Z'),
  updatedAt: new Date('2026-06-30T12:34:56.789Z'),
  workspaceId: 'w1',
  projectId: 'p1',
  createdById: 'u1',
  createdByName: 'U',
};

describe('clientRequirementResponse', () => {
  it('preserves the Django field order + microsecond timestamps', () => {
    const r = clientRequirementResponse({
      id: 'cr1',
      title: 'T',
      description: '',
      clientName: 'Acme',
      priority: 'HIGH',
      status: 'DRAFT',
      attachments: [{ n: 1 }],
      ...base,
    } as ClientRequirement);
    expect(r.createdBy).toBe('u1');
    expect(r.attachments).toEqual([{ n: 1 }]);
    expect(r.createdAt).toBe('2026-06-30T12:34:56.789000Z');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'title', 'description', 'clientName', 'priority',
      'status', 'attachments', 'createdBy', 'createdByName', 'createdAt', 'updatedAt',
    ]);
  });
});

describe('functionalRequirementResponse', () => {
  it('keeps tags/linkedProjectIds as strings and preserves field order', () => {
    const r = functionalRequirementResponse({
      id: 'fr1',
      hierarchyId: 'PRJ-CR-EP-FR-01',
      epicId: '',
      sprintId: '',
      clientRequirementId: 'cr1',
      title: 'T',
      description: '',
      complexity: 'MEDIUM',
      priority: '',
      status: 'DRAFT',
      progress: 0,
      reusable: false,
      assignedTo: ['u1'],
      assignedToNames: ['U'],
      tags: 'a,b,c',
      linkedProjectIds: 'p2,p3',
      ...base,
    } as FunctionalRequirement);
    expect(r.tags).toBe('a,b,c'); // string, not array (wire parity)
    expect(r.linkedProjectIds).toBe('p2,p3');
    expect(r.createdBy).toBe('u1');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'hierarchyId', 'epicId', 'sprintId',
      'clientRequirementId', 'title', 'description', 'complexity', 'priority', 'status',
      'progress', 'reusable', 'assignedTo', 'assignedToNames', 'tags', 'linkedProjectIds',
      'createdBy', 'createdByName', 'createdAt', 'updatedAt',
    ]);
  });
});
