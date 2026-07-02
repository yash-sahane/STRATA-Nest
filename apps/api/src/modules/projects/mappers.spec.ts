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
    logo: '',
    color: '',
    methodology: 'SCRUM',
    status: 'PLANNING',
    archived: false,
    startDate: new Date('2026-01-15T00:00:00.000Z'),
    endDate: null,
    ownerId: 'u1',
    createdById: 'u1',
    createdByName: 'U',
    memberIds: ['u1'],
    projectSettings: { a: 1 },
    ...over,
  } as Project;
}

describe('projectResponse', () => {
  it('formats DateFields as YYYY-MM-DD and datetimes as Django microsecond ISO', () => {
    const r = projectResponse(project());
    expect(r.startDate).toBe('2026-01-15');
    expect(r.endDate).toBeNull();
    expect(r.createdAt).toBe('2026-06-30T12:34:56.789000Z');
  });

  it('maps createdBy/settings and preserves the Django field order', () => {
    const r = projectResponse(project());
    expect(r.createdBy).toBe('u1');
    expect(r.settings).toEqual({ a: 1 });
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'name', 'shortCode', 'description', 'clientName', 'logo', 'color',
      'methodology', 'status', 'archived', 'startDate', 'endDate', 'ownerId', 'createdBy',
      'createdByName', 'memberIds', 'settings', 'createdAt', 'updatedAt',
    ]);
  });
});
