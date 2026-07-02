import type { Retrospective, Sprint } from '@prisma/client';
import { retrospectiveResponse, sprintResponse } from './mappers';

const ts = {
  createdAt: new Date('2026-06-30T12:34:56.789Z'),
  updatedAt: new Date('2026-06-30T12:34:56.789Z'),
};

function sprint(over: Partial<Sprint> = {}): Sprint {
  return {
    id: 's1',
    ...ts,
    workspaceId: 'w1',
    projectId: 'p1',
    name: 'S',
    goal: '',
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    endDate: new Date('2026-03-14T00:00:00.000Z'),
    status: 'PLANNING',
    retrospectiveNotes: '',
    createdById: 'u1',
    createdByName: 'U',
    ...over,
  } as Sprint;
}

function retro(over: Partial<Retrospective> = {}): Retrospective {
  return {
    id: 'r1',
    ...ts,
    sprintId: 's1',
    workspaceId: 'w1',
    projectId: 'p1',
    wentWell: ['good'],
    needsImprovement: [],
    actionItems: [],
    createdById: 'u1',
    ...over,
  } as Retrospective;
}

describe('sprintResponse', () => {
  it('date-only start/end + field order', () => {
    const r = sprintResponse(sprint());
    expect(r.startDate).toBe('2026-03-01');
    expect(r.endDate).toBe('2026-03-14');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'name', 'goal', 'startDate', 'endDate', 'status',
      'retrospectiveNotes', 'createdBy', 'createdByName', 'createdAt', 'updatedAt',
    ]);
  });
});

describe('retrospectiveResponse', () => {
  it('has no createdByName and preserves field order', () => {
    const r = retrospectiveResponse(retro());
    expect(r).not.toHaveProperty('createdByName');
    expect(r.createdBy).toBe('u1');
    expect(Object.keys(r)).toEqual([
      'id', 'workspaceId', 'projectId', 'sprintId', 'wentWell', 'needsImprovement',
      'actionItems', 'createdBy', 'createdAt', 'updatedAt',
    ]);
  });
});
