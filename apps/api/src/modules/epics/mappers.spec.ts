import type { Epic } from '@prisma/client';
import { epicResponse } from './mappers';

function epic(over: Partial<Epic> = {}): Epic {
  return {
    id: 'e1',
    createdAt: new Date('2026-06-30T12:34:56.789Z'),
    updatedAt: new Date('2026-06-30T12:34:56.789Z'),
    workspaceId: 'w1',
    projectId: 'p1',
    requirementId: '',
    hierarchyId: 'PRJ-EP-01',
    name: 'E',
    description: '',
    color: '#3b82f6',
    startDate: new Date('2026-02-01T00:00:00.000Z'),
    endDate: null,
    status: 'TODO',
    progress: 0,
    assignedTeam: '',
    createdById: 'u1',
    createdByName: 'U',
    ...over,
  } as Epic;
}

describe('epicResponse', () => {
  it('formats DateFields date-only and preserves Django field order', () => {
    const r = epicResponse(epic());
    expect(r.startDate).toBe('2026-02-01');
    expect(r.endDate).toBeNull();
    expect(r.createdBy).toBe('u1');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'requirementId', 'hierarchyId', 'name', 'description',
      'color', 'startDate', 'endDate', 'status', 'progress', 'assignedTeam', 'createdBy',
      'createdByName', 'createdAt', 'updatedAt',
    ]);
  });
});
