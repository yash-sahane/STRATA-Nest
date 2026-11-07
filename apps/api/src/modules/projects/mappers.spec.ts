import type { Project } from '@prisma/client';
import { projectResponse } from './mappers';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    createdAt: new Date('2026-06-30T12:34:56.789Z'),
    updatedAt: new Date('2026-06-30T12:34:56.789Z'),
    workspaceId: 'w1',
    name: 'P',
    shortCode: 'PRJ',
    description: '',
    clientName: '',
    status: 'PLANNING',
    startDate: new Date('2026-01-15T00:00:00.000Z'),
    endDate: null,
    ownerId: 'u1',
    createdById: 'u1',
    createdByName: 'U',
    ...over,
  } as Project;
}

describe('projectResponse', () => {
  it('formats DateFields as YYYY-MM-DD and datetimes as microsecond ISO', () => {
    const r = projectResponse(project());
    expect(r.startDate).toBe('2026-01-15');
    expect(r.endDate).toBeNull();
    expect(r.createdAt).toBe('2026-06-30T12:34:56.789000Z');
  });

  it('maps createdBy and preserves the fixed field order', () => {
    const r = projectResponse(project());
    expect(r.createdBy).toBe('u1');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'name', 'shortCode', 'description', 'clientName', 'status',
      'startDate', 'endDate', 'ownerId', 'createdBy', 'createdByName', 'createdAt', 'updatedAt',
    ]);
  });
});
