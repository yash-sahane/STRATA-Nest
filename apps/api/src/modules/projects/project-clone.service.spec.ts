import { NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { NOTICE_EVENT } from '../notifications/notice';
import { ProjectCloneService, projectCodeFor } from './project-clone.service';

jest.mock('@strata/prisma', () => ({
  ...jest.requireActual('@strata/prisma'),
  refreshDeliveryRollups: jest.fn().mockResolvedValue(undefined),
}));

const user = { id: 'u1', name: 'Ada', email: 'ada@x.test' } as User;

const source = {
  id: 'src',
  workspaceId: 'w1',
  name: 'Mobile Alpha',
  shortCode: 'MOA',
  description: '',
  clientName: 'Acme',
  status: 'ACTIVE',
  startDate: null,
  endDate: null,
  ownerId: 'u9',
  createdById: 'u9',
  createdByName: 'Owner',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  version: 0,
};

const day = new Date('2026-11-02T00:00:00.000Z');
const fixtures = {
  sprint: [{ id: 's1', name: 'Sprint 1', goal: 'g', startDate: day, endDate: day, status: 'COMPLETED' }],
  clientRequirement: [
    { id: 'cr1', title: 'CR', description: '', clientName: '', priority: 'HIGH', status: 'APPROVED' },
  ],
  epic: [
    {
      id: 'e1', requirementId: 'cr1', hierarchyId: 'MOA-E1', name: 'Epic', description: '', color: '',
      startDate: null, endDate: null, status: 'DONE', progress: 100,
    },
  ],
  functionalRequirement: [
    {
      id: 'f1', hierarchyId: 'MOA-E1-F1', epicId: 'e1', sprintId: 's1', clientRequirementId: 'cr1',
      parentRequirementId: '', title: 'Parent', description: '', type: 'FEATURE', complexity: 'M',
      priority: 'HIGH', status: 'IMPLEMENTED', progress: 100,
      assigneeIds: ['u2', 'gone'], assigneeNames: ['Bo', 'Gone'],
    },
    {
      id: 'f2', hierarchyId: 'MOA-E1-F2', epicId: 'e1', sprintId: '', clientRequirementId: '',
      parentRequirementId: 'f1', title: 'Child', description: '', type: 'FEATURE', complexity: 'S',
      priority: '', status: 'DRAFT', progress: 0, assigneeIds: [], assigneeNames: [],
    },
  ],
  task: [
    {
      id: 't1', hierarchyId: 'MOA-E1-F1-T1', sprintId: 's1', epicId: 'e1', functionalRequirementId: 'f1',
      parentTaskId: '', title: 'Build', description: '', status: 'DONE', priority: 'HIGH',
      assigneeIds: ['u2', 'gone'], assigneeNames: ['Bo', 'Gone'],
      assignedBy: 'u9', assignedByName: 'Owner', dueDate: day,
      estimatedHours: 3, labels: ['x'], position: 1,
    },
    {
      id: 't2', hierarchyId: 'MOA-E1-F1-T2', sprintId: '', epicId: '', functionalRequirementId: 'f1',
      parentTaskId: 't1', title: 'Sub', description: '', status: 'IN_PROGRESS', priority: 'LOW',
      assigneeIds: ['u2'], assigneeNames: ['Bo'], assignedBy: '', assignedByName: '',
      dueDate: null, estimatedHours: null, labels: [], position: 2,
    },
  ],
};

type Model = keyof typeof fixtures;

function build(
  opts: {
    found?: boolean;
    failFirstWrite?: unknown;
    codes?: string[];
    /** Fields of the source project that differ from `source`. */
    source?: Record<string, unknown>;
    /** Source rows of a table, in place of `fixtures`. */
    rows?: Partial<Record<Model, unknown[]>>;
    /** The workspace's timezone. */
    timezone?: string;
  } = {},
) {
  const from = { ...source, ...opts.source };
  const sourceRows = (model: Model) => opts.rows?.[model] ?? fixtures[model];
  const created: Record<string, unknown[]> = {};
  const createMany = (model: string) =>
    jest.fn(async ({ data }: { data: unknown[] }) => {
      created[model] = data;
      return { count: data.length };
    });
  const tx = {
    project: { createMany: createMany('project') },
    sprint: { createMany: createMany('sprint') },
    clientRequirement: { createMany: createMany('clientRequirement') },
    epic: { createMany: createMany('epic') },
    functionalRequirement: { createMany: createMany('functionalRequirement') },
    task: { createMany: createMany('task') },
  };
  let failures = opts.failFirstWrite ? 1 : 0;
  // Source rows by the source id; the announcement re-reads the copy's own.
  const reader = (model: Model) =>
    jest.fn(async ({ where }: { where: { projectId: string } }) =>
      where.projectId === source.id ? sourceRows(model) : (created[model] ?? []),
    );
  const prisma = {
    // "Today" and the due dates' wall clock are the workspace's.
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ settings: { timezone: opts.timezone ?? 'Asia/Kolkata' } }),
    },
    project: {
      findFirst: jest.fn().mockResolvedValue(opts.found === false ? null : from),
      findMany: jest.fn().mockResolvedValue((opts.codes ?? ['MOA']).map((shortCode) => ({ shortCode }))),
      // As the database returns it: the row written, with its timestamps.
      findUniqueOrThrow: jest.fn(async () => ({
        ...(created.project as Record<string, unknown>[])[0],
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })),
    },
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]),
    },
    sprint: { findMany: reader('sprint') },
    clientRequirement: { findMany: reader('clientRequirement') },
    epic: { findMany: reader('epic') },
    functionalRequirement: { findMany: reader('functionalRequirement') },
    task: { findMany: reader('task') },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      if (failures > 0) {
        failures -= 1;
        throw opts.failFirstWrite;
      }
      return fn(tx);
    }),
    announceWrite: jest.fn(),
  };
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
    assertPermission: jest.fn().mockResolvedValue(undefined),
  };
  const events = { emit: jest.fn() };
  const service = new ProjectCloneService(
    prisma as unknown as PrismaService,
    access as unknown as WorkspaceAccessService,
    events as unknown as EventEmitter2,
  );
  return { service, prisma, access, events, created };
}

const everything = {
  name: 'Shiny New',
  includeTasks: true,
  includeSprints: true,
};

describe('ProjectCloneService', () => {
  it('derives the code the create form derives', () => {
    expect(projectCodeFor('Mobile App')).toBe('MOA');
    expect(projectCodeFor('Shiny New')).toBe('SHN');
    expect(projectCodeFor('Go')).toBe('GOO');
    expect(projectCodeFor('🚀')).toBe('PRJ');
  });

  it('writes every child already pointing at its copied parent, under the new code', async () => {
    const { service, created, prisma } = build();
    const result = await service.clone(user, 'src', everything);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const [project] = created.project as Record<string, unknown>[];
    expect(project).toMatchObject({ shortCode: 'SHN', ownerId: 'u1', status: 'PLANNING', clientName: 'Acme' });
    const [sprint] = created.sprint as Record<string, unknown>[];
    const [requirement] = created.clientRequirement as Record<string, unknown>[];
    const [epic] = created.epic as Record<string, unknown>[];
    const [parent, child] = created.functionalRequirement as Record<string, unknown>[];
    const [task, sub] = created.task as Record<string, unknown>[];

    for (const row of [sprint, requirement, epic, parent, child, task, sub]) {
      expect(row.projectId).toBe(project.id);
    }
    expect(sprint.status).toBe('PLANNING');
    expect(epic).toMatchObject({ requirementId: requirement.id, hierarchyId: 'SHN-E1', status: 'TODO', progress: 0 });
    expect(parent).toMatchObject({ epicId: epic.id, sprintId: sprint.id, clientRequirementId: requirement.id });
    expect(child.parentRequirementId).toBe(parent.id);
    expect(task).toMatchObject({
      hierarchyId: 'SHN-E1-F1-T1',
      sprintId: sprint.id,
      epicId: epic.id,
      functionalRequirementId: parent.id,
      status: 'TODO',
      blockedBy: [],
    });
    expect(sub.parentTaskId).toBe(task.id);
    // No source id survives anywhere in the copy.
    expect(JSON.stringify(created)).not.toMatch(/"(s1|cr1|e1|f1|f2|t1|t2)"/);
    expect(result.copied).toMatchObject({ sprints: 1, epics: 1, functionalRequirements: 2, tasks: 2 });
  });

  it('copies work for somebody who has left unassigned, and says how much', async () => {
    const { service, created } = build();
    const result = await service.clone(user, 'src', everything);
    const [task] = created.task as Record<string, unknown>[];
    expect(task).toMatchObject({ assigneeIds: ['u2'], assigneeNames: ['Bo'] });
    const [parent] = created.functionalRequirement as Record<string, unknown>[];
    expect(parent).toMatchObject({ assigneeIds: ['u2'], assigneeNames: ['Bo'] });
    expect(result.copied.assignmentsDropped).toBe(2);
  });

  it('asks for the permission each part it copies needs', async () => {
    const bare = build();
    await bare.service.clone(user, 'src', { name: 'Bare' });
    expect(bare.access.assertPermission.mock.calls.map((c) => c[2])).toEqual([Permission.ProjectCreate]);

    const full = build();
    await full.service.clone(user, 'src', everything);
    expect(full.access.assertPermission.mock.calls.map((c) => c[2])).toEqual([
      Permission.ProjectCreate,
      Permission.PlanningWrite,
      Permission.RequirementWrite,
      Permission.PlanningWrite,
      Permission.TaskCreate,
    ]);
  });

  it('copies nothing but the project when nothing else is asked for', async () => {
    const { service, created } = build();
    await service.clone(user, 'src', { name: 'Bare' });
    expect(Object.keys(created)).toEqual(['project']);
    const [project] = created.project as Record<string, unknown>[];
    expect(project).toMatchObject({ name: 'Bare', status: 'PLANNING' });
  });

  it('does not find a project outside the caller\'s workspaces', async () => {
    const { service, access } = build({ found: false });
    await expect(service.clone(user, 'src', everything)).rejects.toBeInstanceOf(NotFoundException);
    expect(access.assertPermission).not.toHaveBeenCalled();
  });

  it('tells each person with work once, with how much', async () => {
    const { service, events } = build();
    await service.clone(user, 'src', everything);
    const notices = events.emit.mock.calls.filter(([name]) => name === NOTICE_EVENT).map(([, n]) => n);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ recipients: ['u2'], type: 'TASK_ASSIGNED', title: '2 tasks for you in Shiny New' });
  });

  it('announces the copy only once it is committed', async () => {
    const { service, prisma } = build();
    await service.clone(user, 'src', everything);
    const announced = prisma.announceWrite.mock.calls.map(([model]) => model);
    expect(announced.filter((m) => m === 'Project')).toHaveLength(1);
    expect(announced.filter((m) => m === 'Task')).toHaveLength(2);
    // Every announcement came after the transaction returned.
    const committed = prisma.$transaction.mock.invocationCallOrder[0];
    for (const order of prisma.announceWrite.mock.invocationCallOrder) expect(order).toBeGreaterThan(committed);
  });

  it('takes the next code when another project took this one in between', async () => {
    const clash = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['workspace_id', 'short_code'] },
    });
    const { service, prisma, created } = build({ failFirstWrite: clash });
    await service.clone(user, 'src', everything);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.project.findMany).toHaveBeenCalledTimes(2);
    expect((created.project as Record<string, unknown>[])[0].shortCode).toBe('SHN');
  });

  it('never reuses a code that is taken', async () => {
    const { service, created } = build({ codes: ['MOA', 'SHN', 'SHN2'] });
    await service.clone(user, 'src', { name: 'Shiny New' });
    expect((created.project as Record<string, unknown>[])[0].shortCode).toBe('SHN3');
  });

  it('hands the carried-over assignments out from the person making the copy', async () => {
    const { service, created } = build();
    await service.clone(user, 'src', everything);
    const [task, sub] = created.task as Record<string, unknown>[];
    expect(task).toMatchObject({ assignedBy: 'u1', assignedByName: 'Ada' });
    expect(sub).toMatchObject({ assignedBy: 'u1', assignedByName: 'Ada' });
  });

  it('starts a client requirement over at Approved when its work had moved it on', async () => {
    const { service, created } = build({
      rows: {
        clientRequirement: [
          { ...fixtures.clientRequirement[0], status: 'COMPLETED' },
          { id: 'cr2', title: 'Draft', description: '', clientName: '', priority: 'LOW', status: 'DRAFT' },
        ],
      },
    });
    await service.clone(user, 'src', everything);
    expect((created.clientRequirement as Record<string, unknown>[]).map((r) => r.status)).toEqual([
      'APPROVED',
      'DRAFT',
    ]);
  });

  it('copies an archived project into a new one in Planning', async () => {
    const { service, created } = build({ source: { status: 'ARCHIVED' } });
    await service.clone(user, 'src', everything);
    expect((created.project as Record<string, unknown>[])[0]).toMatchObject({ status: 'PLANNING' });
  });
});

describe('ProjectCloneService — the copy starts on its own day', () => {
  afterEach(() => jest.useRealTimers());

  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  /** The source as it was planned last January. */
  const january = {
    source: { startDate: day('2026-01-05'), endDate: day('2026-03-31') },
    rows: {
      sprint: [{ id: 's1', name: 'Sprint 1', goal: '', startDate: day('2026-01-05'), endDate: day('2026-01-18'), status: 'COMPLETED' }],
      epic: [{ ...fixtures.epic[0], startDate: day('2026-01-10'), endDate: day('2026-02-01') }],
      // Due on the 13th: India's midnight, as the browser's picker stores it.
      task: [{ ...fixtures.task[0], dueDate: new Date('2026-01-12T18:30:00.000Z') }, fixtures.task[1]],
    },
  };
  const rowOf = (created: Record<string, unknown[]>, table: string) =>
    (created[table] as Record<string, unknown>[])[0];

  it("moves every date by the days from the source's start to today in the workspace", async () => {
    // 06:00 UTC on 7 November is 11:30 in India: today there is the 7th.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-07T06:00:00.000Z'));
    const { service, created } = build(january);
    const result = await service.clone(user, 'src', everything);

    expect(rowOf(created, 'project')).toMatchObject({ startDate: day('2026-11-07'), endDate: day('2027-01-31') });
    expect(rowOf(created, 'sprint')).toMatchObject({
      status: 'PLANNING',
      startDate: day('2026-11-07'),
      endDate: day('2026-11-20'),
    });
    expect(rowOf(created, 'epic')).toMatchObject({ startDate: day('2026-11-12'), endDate: day('2026-12-04') });
    // Still India's midnight, eight days after the start, as it was.
    expect(rowOf(created, 'task').dueDate).toEqual(new Date('2026-11-14T18:30:00.000Z'));
    expect((created.task as Record<string, unknown>[])[1].dueDate).toBeNull();
    expect(result.copied.daysMoved).toBe(306);
  });

  it('starts on the day the request names', async () => {
    const { service, created } = build(january);
    await service.clone(user, 'src', { ...everything, startDate: '2027-01-04' });
    expect(rowOf(created, 'project')).toMatchObject({ startDate: day('2027-01-04') });
    expect(rowOf(created, 'sprint')).toMatchObject({ startDate: day('2027-01-04'), endDate: day('2027-01-17') });
  });

  it('measures a source that never had a start from its earliest date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-07T06:00:00.000Z'));
    const { service, created } = build({
      source: { startDate: null, endDate: null },
      rows: {
        sprint: [{ id: 's1', name: 'Sprint 1', goal: '', startDate: day('2026-01-10'), endDate: day('2026-01-20'), status: 'ACTIVE' }],
        // The 9th in India — a day before the sprint.
        task: [{ ...fixtures.task[0], dueDate: new Date('2026-01-08T18:30:00.000Z') }],
      },
    });
    await service.clone(user, 'src', everything);
    expect(rowOf(created, 'project')).toMatchObject({ startDate: day('2026-11-07'), endDate: null });
    expect(rowOf(created, 'task').dueDate).toEqual(new Date('2026-11-06T18:30:00.000Z'));
    expect(rowOf(created, 'sprint')).toMatchObject({ startDate: day('2026-11-08') });
  });

  it("keeps a due date's time of day across a daylight-saving change", async () => {
    const { service, created } = build({
      timezone: 'Europe/London',
      source: { startDate: day('2026-07-01'), endDate: null },
      // Midnight in London on 2 July is 23:00 UTC on the 1st (summer time).
      rows: { task: [{ ...fixtures.task[0], dueDate: new Date('2026-07-01T23:00:00.000Z') }] },
    });
    await service.clone(user, 'src', { ...everything, startDate: '2026-12-01' });
    // Midnight in London on 2 December — winter time, so 00:00 UTC — not
    // 23:00 UTC on the 1st, which is the day before.
    expect(rowOf(created, 'task').dueDate).toEqual(new Date('2026-12-02T00:00:00.000Z'));
  });
});
