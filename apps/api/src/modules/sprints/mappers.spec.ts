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
    // Null by default, matching a row written before the snapshot existed.
    completedAt: null,
    completedTaskCount: null,
    totalTaskCount: null,
    rolledOverTaskCount: null,
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
      'retrospectiveNotes', 'completedAt', 'completedTaskCount', 'totalTaskCount',
      'rolledOverTaskCount', 'createdBy', 'createdByName', 'createdAt', 'updatedAt',
    ]);
  });

  it('carries the completion snapshot for a sprint that recorded one', () => {
    // Completing a sprint rolls its unfinished tasks OUT, so counting tasks by
    // sprintId afterwards finds only the DONE ones and the analytics page read
    // 100% for every completed sprint. These four fields are the only surviving
    // record of what it actually got through.
    const r = sprintResponse(
      sprint({
        status: 'COMPLETED',
        completedAt: new Date('2026-06-30T12:34:56.789Z'),
        completedTaskCount: 2,
        totalTaskCount: 5,
        rolledOverTaskCount: 3,
      }),
    );
    expect(r.completedAt).toBe('2026-06-30T12:34:56.789000Z');
    expect(r.completedTaskCount).toBe(2);
    expect(r.totalTaskCount).toBe(5);
    expect(r.rolledOverTaskCount).toBe(3);
  });

  it('reports NULL, not zero, for a sprint closed before figures were kept', () => {
    // Zero would read as "this sprint finished nothing", which is a different
    // claim from "nobody recorded what it finished" — and the one the UI has to
    // distinguish in order to say "not recorded" instead of showing 0%.
    const r = sprintResponse(sprint({ status: 'COMPLETED' }));
    expect(r.completedAt).toBeNull();
    expect(r.completedTaskCount).toBeNull();
    expect(r.totalTaskCount).toBeNull();
    expect(r.rolledOverTaskCount).toBeNull();
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
