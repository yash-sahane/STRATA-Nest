import type { EventEmitter2 } from '@nestjs/event-emitter';
import { parseListQuery } from '@strata/common';
import type { PrismaService } from '@strata/prisma';
import type { Task, User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TasksService } from './tasks.services';

const user = { id: 'u1', name: 'U' } as User;

/** For the cases that are not about the events a write announces. */
const noEvents = { emit: jest.fn() } as unknown as EventEmitter2;

const stored = {
  id: 't1',
  workspaceId: 'w1',
  projectId: 'p1',
  hierarchyId: 'ABC-T01',
  sprintId: '',
  epicId: '',
  functionalRequirementId: '',
  parentTaskId: '',
  title: 'T',
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  assigneeIds: [],
  assigneeNames: [],
  assignedBy: '',
  assignedByName: '',
  createdById: 'u1',
  createdByName: 'U',
  dueDate: null,
  estimatedHours: null,
  labels: [],
  position: 0,
  blockedBy: [],
  blocks: [],
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} as unknown as Task;

function build(current: Partial<Task> = {}) {
  const row = { ...stored, ...current } as Task;
  const update = jest.fn().mockResolvedValue(row);
  const create = jest.fn().mockResolvedValue(row);
  // Backing for the cross-workspace guards create() runs: a task may not point
  // at a project in a workspace the caller cannot reach, nor at a sprint/epic/
  // FR/parent belonging to a different project.
  const project = { findUnique: jest.fn().mockResolvedValue({ workspaceId: 'w1' }) };
  // A parent as the link guards see it, and as the roll-up does: it has a
  // status and a progress, and can be written when its tasks move them.
  const sibling = () => ({
    findUnique: jest.fn().mockResolvedValue({ projectId: 'p1', status: 'TODO', progress: 0 }),
    update: jest.fn().mockResolvedValue({}),
    // An epic's roll-up also counts its requirements that have no task yet.
    findMany: jest.fn().mockResolvedValue([]),
  });
  // Two questions reach findFirst: the scoped read of THIS task, and "is this
  // hierarchy id taken?" — the one that names an id. No id is taken unless a
  // case lists it.
  const taken: string[] = [];
  const findFirst = jest.fn((args: { where?: { hierarchyId?: unknown } }) => {
    const hierarchyId = args?.where?.hierarchyId;
    if (typeof hierarchyId === 'string') {
      return Promise.resolve(taken.includes(hierarchyId) ? { id: 'other' } : null);
    }
    return Promise.resolve(row);
  });
  const prisma = {
    task: {
      update,
      create,
      findFirst,
      findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }),
      // The roll-up counts the parent's tasks.
      count: jest.fn().mockResolvedValue(0),
      // A new card goes one past the highest position in the project.
      aggregate: jest.fn().mockResolvedValue({ _max: { position: null } }),
    },
    // assigneeNamesFor() resolves assignee display names from here — a name is
    // not derivable from an id, so the service has to look it up.
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'u2', name: 'Dev', email: 'dev@x.test' },
        { id: 'u3', name: '', email: 'tester@x.test' },
      ]),
    },
    // Assignees must be ACTIVE members of the workspace, so create() checks the
    // roster. 'u2' is the assignee these tests use.
    workspaceMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }]) },
    project,
    sprint: sibling(),
    epic: sibling(),
    functionalRequirement: sibling(),
    clientRequirement: sibling(),
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  const emit = jest.fn();
  const events = { emit } as unknown as EventEmitter2;
  return {
    svc: new TasksService(prisma, access, events),
    update,
    create,
    access,
    project,
    prisma,
    emit,
    taken,
  };
}

describe('TasksService self-reference guard', () => {
  it('rejects a task parenting itself', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 't1', { parentTaskId: 't1' })).rejects.toThrow(
      'A task cannot be its own parent',
    );
    expect(update).not.toHaveBeenCalled();
  });

  // Dependency arrays are no longer writable through PATCH at all: one side of
  // an edge on its own desynchronises the graph and skips the cycle check, so
  // every caller has to go through the transactional dependency endpoints.
  it('refuses to write a dependency array through PATCH', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 't1', { blocks: ['t2', 't1'] })).rejects.toThrow(
      '/tasks/{id}/dependencies',
    );
    await expect(svc.patch(user, 't1', { blockedBy: ['t2'] })).rejects.toThrow(
      '/tasks/{id}/dependencies',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('allows an ordinary re-parent', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 't1', { parentTaskId: 't2' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  // The same argument applies to CREATE, which used to copy both arrays
  // verbatim: the named blocker's own `blocks` was never updated, so the cycle
  // check saw an edge the reverse index did not and the dependency UI rendered
  // it on one card only.
  it('ignores dependency arrays on create', async () => {
    const { svc, create } = build();
    await svc.create(user, {
      workspaceId: 'w1',
      projectId: 'p1',
      hierarchyId: 'P-T-01',
      title: 'New',
      blockedBy: ['t2'],
      blocks: ['t3'],
    } as Parameters<typeof svc.create>[1]);
    const { data } = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.blockedBy).toEqual([]);
    expect(data.blocks).toEqual([]);
  });
});

describe('TasksService completedAt stamping', () => {
  const dataOf = (update: jest.Mock) => update.mock.calls[0][0].data as Record<string, unknown>;

  it('stamps completedAt on the transition into DONE', async () => {
    const { svc, update } = build({ status: 'REVIEW' });
    await svc.patch(user, 't1', { status: 'DONE' });
    expect(dataOf(update).completedAt).toBeInstanceOf(Date);
  });

  it('leaves completedAt alone when an already-DONE task is re-saved', async () => {
    const { svc, update } = build({ status: 'DONE' });
    await svc.patch(user, 't1', { status: 'DONE', title: 'renamed' });
    expect(dataOf(update)).not.toHaveProperty('completedAt');
  });

  it('clears completedAt when a task is reopened', async () => {
    const { svc, update } = build({ status: 'DONE' });
    await svc.patch(user, 't1', { status: 'IN_PROGRESS' });
    expect(dataOf(update).completedAt).toBeNull();
  });

  it('does not touch completedAt on a patch that omits status', async () => {
    const { svc, update } = build({ status: 'DONE' });
    await svc.patch(user, 't1', { title: 'renamed' });
    expect(dataOf(update)).not.toHaveProperty('completedAt');
  });

  it('refuses DONE from any status other than REVIEW (server-side, not just the UI)', async () => {
    const { svc, update } = build({ status: 'IN_PROGRESS' });
    await expect(svc.patch(user, 't1', { status: 'DONE' })).rejects.toThrow(
      'Tasks must be reviewed before they can be marked done',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses DONE without task:write, whatever the role is CALLED', async () => {
    // The browser test was `role.includes('manager')`, which no custom role could
    // satisfy and no platform admin could pass. The server resolves the real
    // permission set instead.
    const { svc, update, access } = build({ status: 'REVIEW' });
    (access.can as jest.Mock).mockResolvedValue(false);
    await expect(svc.patch(user, 't1', { status: 'DONE' })).rejects.toThrow(
      'Only managers or assistant managers can mark tasks as done.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('does not re-gate an unrelated edit on an already-DONE task', async () => {
    const { svc, update, access } = build({ status: 'DONE' });
    (access.can as jest.Mock).mockResolvedValue(false);
    await expect(svc.patch(user, 't1', { status: 'DONE', title: 'renamed' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('refuses to create a task straight into DONE', async () => {
    // PATCH has enforced the REVIEW gate all along (patchStatus), but create
    // accepted status:'DONE' outright and stamped completedAt — the same rule,
    // skipped by the other door. A brand-new task cannot have been reviewed.
    const { svc, create } = build();
    await expect(
      svc.create(user, {
        workspaceId: 'w1',
        projectId: 'p1',
        hierarchyId: 'ABC-T02',
        title: 'T',
        status: 'DONE',
      }),
    ).rejects.toThrow(/pass through Review/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an assignee who is not an active member of the workspace', async () => {
    const { svc, create, prisma } = build();
    (prisma.workspaceMember.findMany as jest.Mock).mockResolvedValueOnce([]);
    await expect(
      svc.create(user, {
        workspaceId: 'w1',
        projectId: 'p1',
        hierarchyId: 'ABC-T09',
        title: 'T',
        assigneeIds: ['not-a-member'],
      }),
    ).rejects.toThrow(/active member/i);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('TasksService assignees', () => {
  // One list. The names beside it, and who handed the work out, are the
  // server's: a client that sent `assignedToNames: []` blanked every name on
  // the board, and "assigned by" was whatever the form said.
  it('writes the names from the user table and the creator as the one who assigned', async () => {
    const { svc, create } = build();
    await svc.create(user, {
      workspaceId: 'w1',
      projectId: 'p1',
      hierarchyId: 'ABC-T03',
      title: 'T',
      assigneeIds: ['u2', 'u3'],
    });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.assigneeIds).toEqual(['u2', 'u3']);
    // Index-aligned with the ids; an account with no name shows its email.
    expect(data.assigneeNames).toEqual(['Dev', 'tester@x.test']);
    expect(data).toMatchObject({ assignedBy: 'u1', assignedByName: 'U' });
  });

  it('a task nobody is on was assigned by nobody', async () => {
    const { svc, create } = build();
    await svc.create(user, { workspaceId: 'w1', projectId: 'p1', hierarchyId: 'ABC-T04', title: 'T' });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ assigneeIds: [], assigneeNames: [], assignedBy: '' });
  });

  it('a reassignment records who made it; a save that keeps the people does not', async () => {
    const { svc, update } = build({ assigneeIds: ['u2'] as never, assignedBy: 'someone-else' });
    await svc.patch(user, 't1', { assigneeIds: ['u3'] });
    expect(update.mock.calls[0][0].data).toMatchObject({
      assigneeIds: ['u3'],
      assignedBy: 'u1',
      assignedByName: 'U',
    });
    update.mockClear();
    await svc.patch(user, 't1', { assigneeIds: ['u2'] });
    expect(update.mock.calls[0][0].data.assignedBy).toBeUndefined();
  });
});

/** In-memory task graph for the dependency tests (findFirst/findMany/update). */
function buildGraph(seed: Record<string, Partial<Task>>, archived: string[] = []) {
  const rows = new Map<string, Task>(
    Object.entries(seed).map(([id, t]) => [id, { ...stored, id, ...t } as Task]),
  );
  const update = jest.fn(({ where, data }: { where: { id: string }; data: object }) => {
    const next = { ...(rows.get(where.id) as Task), ...data } as Task;
    rows.set(where.id, next);
    return Promise.resolve(next);
  });
  const prisma = {
    task: {
      update,
      findFirst: jest.fn(({ where }: { where: { AND: Array<{ id?: string }> } }) => {
        const id = where.AND.find((c) => c.id)?.id as string;
        return Promise.resolve(rows.get(id) ?? null);
      }),
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((i) => rows.get(i)).filter(Boolean)),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      ),
    },
    // Each end's project, by id: `archived` lists the ones that are archived.
    project: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ status: archived.includes(where.id) ? 'ARCHIVED' : 'ACTIVE' }),
      ),
    },
    // The per-workspace advisory lock the edge is written under.
    $executeRaw: jest.fn().mockResolvedValue(1),
  } as Record<string, unknown>;
  // An interactive transaction: the body runs against the same client.
  prisma.$transaction = jest.fn((body: (tx: unknown) => Promise<unknown>) => body(prisma));
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  return {
    svc: new TasksService(prisma as unknown as PrismaService, access, noEvents),
    rows,
    prisma,
  };
}

describe('TasksService dependency edges', () => {
  it('rejects a self-edge', async () => {
    const { svc } = buildGraph({ t1: {} });
    await expect(
      svc.addDependency(user, 't1', { targetTaskId: 't1', type: 'blockedBy' }),
    ).rejects.toThrow('A task cannot depend on itself');
  });

  it('rejects an edge between two workspaces', async () => {
    const { svc } = buildGraph({ t1: {}, t2: { workspaceId: 'w2' } });
    await expect(
      svc.addDependency(user, 't1', { targetTaskId: 't2', type: 'blockedBy' }),
    ).rejects.toThrow('different workspaces');
  });

  it('writes both halves of the edge in one transaction', async () => {
    const { svc, rows, prisma } = buildGraph({ t1: {}, t2: {} });
    await svc.addDependency(user, 't1', { targetTaskId: 't2', type: 'blockedBy' });
    expect(rows.get('t1')!.blockedBy).toEqual(['t2']);
    expect(rows.get('t2')!.blocks).toEqual(['t1']);
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalledTimes(1);
    // Under the workspace's dependency lock, so two edges cannot interleave.
    expect((prisma as unknown as { $executeRaw: jest.Mock }).$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('adds to the edges as they stand when the lock is held, not as first read', async () => {
    const { svc, rows } = buildGraph({ t1: {}, t2: {}, t3: {} });
    // Another edge lands on t1 between the scoped read and the locked one.
    rows.set('t1', { ...(rows.get('t1') as Task), blockedBy: ['t3'] });
    await svc.addDependency(user, 't1', { targetTaskId: 't2', type: 'blockedBy' });
    expect(rows.get('t1')!.blockedBy).toEqual(['t3', 't2']);
  });

  it('records the mirror half for a `blocks` edge too', async () => {
    const { svc, rows } = buildGraph({ t1: {}, t2: {} });
    await svc.addDependency(user, 't1', { targetTaskId: 't2', type: 'blocks' });
    expect(rows.get('t1')!.blocks).toEqual(['t2']);
    expect(rows.get('t2')!.blockedBy).toEqual(['t1']);
  });

  it('rejects a direct cycle', async () => {
    const { svc } = buildGraph({ t1: { blocks: ['t2'] }, t2: { blockedBy: ['t1'] } });
    await expect(
      svc.addDependency(user, 't1', { targetTaskId: 't2', type: 'blockedBy' }),
    ).rejects.toThrow('circular dependency');
  });

  it('rejects a transitive cycle (t1 → t2 → t3 → t1)', async () => {
    const { svc } = buildGraph({
      t1: { blocks: ['t2'] },
      t2: { blockedBy: ['t1'], blocks: ['t3'] },
      t3: { blockedBy: ['t2'] },
    });
    await expect(
      svc.addDependency(user, 't1', { targetTaskId: 't3', type: 'blockedBy' }),
    ).rejects.toThrow('circular dependency');
  });

  it('allows a diamond (shared ancestor, no cycle)', async () => {
    const { svc, rows } = buildGraph({
      t1: { blocks: ['t2', 't3'] },
      t2: { blockedBy: ['t1'] },
      t3: { blockedBy: ['t1'] },
      t4: {},
    });
    await svc.addDependency(user, 't4', { targetTaskId: 't2', type: 'blockedBy' });
    expect(rows.get('t4')!.blockedBy).toEqual(['t2']);
  });

  it('terminates on an already-cyclic graph instead of spinning', async () => {
    const { svc } = buildGraph({
      t1: { blockedBy: ['t2'] },
      t2: { blockedBy: ['t1'] },
      t3: {},
    });
    await expect(
      svc.addDependency(user, 't3', { targetTaskId: 't1', type: 'blockedBy' }),
    ).resolves.toBeDefined();
  });

  it('clears both halves on remove', async () => {
    const { svc, rows } = buildGraph({
      t1: { blockedBy: ['t2'] },
      t2: { blocks: ['t1'] },
    });
    await svc.removeDependency(user, 't1', 't2', 'blockedBy');
    expect(rows.get('t1')!.blockedBy).toEqual([]);
    expect(rows.get('t2')!.blocks).toEqual([]);
  });
});

describe('TasksService list spec', () => {
  it('honours a dueDate range filter (deadline reminders depend on it)', () => {
    const spec = (new TasksService({} as PrismaService, {} as WorkspaceAccessService, noEvents) as unknown as {
      spec: Parameters<typeof parseListQuery>[1];
    }).spec;
    const parsed = parseListQuery(
      { dueDate__gte: '2026-08-01T00:00:00.000Z', dueDate__lte: '2026-08-08T00:00:00.000Z' },
      spec,
    );
    expect(parsed.where.dueDate).toEqual({
      gte: new Date('2026-08-01T00:00:00.000Z'),
      lte: new Date('2026-08-08T00:00:00.000Z'),
    });
  });

  it('honours ordering by dueDate', () => {
    const spec = (new TasksService({} as PrismaService, {} as WorkspaceAccessService, noEvents) as unknown as {
      spec: Parameters<typeof parseListQuery>[1];
    }).spec;
    // The leading key: parseListQuery may append `id` to make the order total.
    const [leading] = [parseListQuery({ ordering: 'dueDate' }, spec).orderBy].flat();
    expect(leading).toEqual({ dueDate: 'asc' });
  });
});

describe('TasksService — the people a write concerns are told', () => {
  /** The (name, payload) of every event a call emitted. */
  const announced = (emit: jest.Mock) =>
    emit.mock.calls.map(([name, event]) => [name, (event as { payload: unknown }).payload]);

  it('a new task tells its assignees', async () => {
    const { svc, emit } = build({ id: 'new' });
    await svc.create(user, {
      workspaceId: 'w1',
      projectId: 'p1',
      hierarchyId: 'ABC-T02',
      title: 'Ship it',
      assigneeIds: ['u2', 'u2'],
    } as never);
    expect(announced(emit)).toEqual([
      [
        'task.assigned',
        expect.objectContaining({ taskId: 'new', title: 'Ship it', actorId: 'u1', assigneeIds: ['u2'] }),
      ],
    ]);
  });

  it('a reassignment tells only the people who were ADDED', async () => {
    const { svc, emit } = build({ assigneeIds: ['u2'] as never });
    await svc.patch(user, 't1', { assigneeIds: ['u2', 'u3'] });
    expect(announced(emit)).toEqual([
      ['task.assigned', expect.objectContaining({ assigneeIds: ['u3'] })],
    ]);
  });

  it('a move tells the assignees where the task went, and where it came from', async () => {
    const { svc, emit } = build({ assigneeIds: ['u2'] as never, sprintId: 's1' });
    await svc.patch(user, 't1', { status: 'IN_PROGRESS' });
    expect(announced(emit)).toEqual([
      [
        'task.status_changed',
        expect.objectContaining({ from: 'TODO', to: 'IN_PROGRESS', assigneeIds: ['u2'], sprintId: 's1' }),
      ],
    ]);
  });

  it('re-saving the status and priority a task already has announces nothing', async () => {
    const { svc, emit } = build();
    await svc.patch(user, 't1', { status: 'TODO', priority: 'MEDIUM' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('a reorder neither reads the task nor announces anything', async () => {
    const { svc, emit, prisma } = build();
    await svc.patch(user, 't1', { position: 4 });
    expect(emit).not.toHaveBeenCalled();
    // One read at most: the scoped fetch `update` itself makes.
    const { findFirst } = (prisma as unknown as { task: { findFirst: jest.Mock } }).task;
    expect(findFirst.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('TasksService.patch — the checks create runs, by the other door', () => {
  it('refuses to add an assignee who is not an active member of the workspace', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 't1', { assigneeIds: ['stranger'] })).rejects.toThrow(
      'Cannot assign this task to somebody who is not an active member of the workspace.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('does not hold a former member already on the task against the rest of the edit', async () => {
    const { svc } = build({ assigneeIds: ['left-the-company'] as never });
    await expect(
      svc.patch(user, 't1', { assigneeIds: ['left-the-company', 'u2'] }),
    ).resolves.toBeDefined();
  });

  it('refuses a sprint, epic or requirement from another project', async () => {
    for (const [model, field] of [
      ['sprint', 'sprintId'],
      ['epic', 'epicId'],
      ['functionalRequirement', 'functionalRequirementId'],
    ] as const) {
      const { svc, prisma, update } = build();
      (prisma as unknown as Record<string, { findUnique: jest.Mock }>)[model].findUnique.mockResolvedValue({
        projectId: 'another-project',
      });
      await expect(svc.patch(user, 't1', { [field]: 'x1' })).rejects.toThrow(
        'belongs to a different project.',
      );
      expect(update).not.toHaveBeenCalled();
    }
  });

  // task:update works the board; moving the work into another sprint, epic or
  // requirement re-plans it, which is planning:write.
  it('asks for planning:write to move a task into another sprint, epic or requirement', async () => {
    for (const field of ['sprintId', 'epicId', 'functionalRequirementId'] as const) {
      const { svc, access } = build();
      await svc.patch(user, 't1', { [field]: 'x-new' }).catch(() => undefined);
      expect(access.assertPermission).toHaveBeenCalledWith(user, 'w1', 'planning:write');
    }
  });

  it('does not ask for it when the parents are sent back unchanged', async () => {
    const { svc, access } = build({ sprintId: 's1', epicId: 'e1' } as never);
    await svc.patch(user, 't1', { sprintId: 's1', epicId: 'e1', title: 'Renamed' });
    expect(access.assertPermission).not.toHaveBeenCalledWith(user, 'w1', 'planning:write');
  });

  it('refuses to reopen a finished task without task:write', async () => {
    const { svc, access, update } = build({ status: 'DONE' });
    (access.can as jest.Mock).mockResolvedValue(false);
    await expect(svc.patch(user, 't1', { status: 'TODO' })).rejects.toThrow(
      'Only managers or assistant managers can reopen a finished task.',
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('TasksService — a task follows its requirement', () => {
  type Lookup = Record<string, { findUnique: jest.Mock }>;
  const createData = (create: jest.Mock) => create.mock.calls[0][0].data as Record<string, unknown>;
  const updateData = (update: jest.Mock) => update.mock.calls[0][0].data as Record<string, unknown>;
  const fresh = { workspaceId: 'w1', projectId: 'p1', hierarchyId: 'P-T-01', title: 'New' };

  /** The requirement sits in sprint `s1` under epic `e1`; the sprint has `status`. */
  function planned(status: string, current: Partial<Task> = {}) {
    const built = build(current);
    const lookup = built.prisma as unknown as Lookup;
    lookup.functionalRequirement.findUnique.mockResolvedValue({
      projectId: 'p1',
      sprintId: 's1',
      epicId: 'e1',
    });
    lookup.sprint.findUnique.mockResolvedValue({ projectId: 'p1', status });
    return built;
  }

  it('creates the task in its requirement\'s sprint and epic', async () => {
    const { svc, create } = planned('PLANNING');
    await svc.create(user, { ...fresh, functionalRequirementId: 'fr1' } as Parameters<
      typeof svc.create
    >[1]);
    expect(createData(create)).toMatchObject({ sprintId: 's1', epicId: 'e1', status: 'BACKLOG' });
  });

  it('keeps an epic the caller names explicitly', async () => {
    const { svc, create } = planned('PLANNING');
    await svc.create(user, { ...fresh, functionalRequirementId: 'fr1', epicId: 'e9' } as Parameters<
      typeof svc.create
    >[1]);
    expect(createData(create)).toMatchObject({ sprintId: 's1', epicId: 'e9' });
  });

  // The running sprint's board has no Backlog column, so a task that joins it
  // by way of its requirement has to land where the board can show it.
  it('starts a task that joins a running sprint at To Do', async () => {
    const { svc, create } = planned('ACTIVE');
    await svc.create(user, { ...fresh, functionalRequirementId: 'fr1' } as Parameters<
      typeof svc.create
    >[1]);
    expect(createData(create)).toMatchObject({ sprintId: 's1', status: 'TODO' });
  });

  // A delivered requirement stays in the sprint that delivered it. Following it
  // there refused every follow-up task; the task is filed unplanned instead.
  it('files a new task under a delivered requirement outside every sprint', async () => {
    const { svc, create } = planned('COMPLETED');
    await svc.create(user, { ...fresh, functionalRequirementId: 'fr1' } as Parameters<
      typeof svc.create
    >[1]);
    expect(createData(create)).toMatchObject({
      functionalRequirementId: 'fr1',
      sprintId: '',
      epicId: 'e1',
      status: 'BACKLOG',
    });
  });

  it('still refuses a closed sprint the caller names', async () => {
    const { svc, create } = planned('COMPLETED');
    await expect(
      svc.create(user, { ...fresh, sprintId: 's1' } as Parameters<typeof svc.create>[1]),
    ).rejects.toThrow('That sprint is completed.');
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves a task with no requirement outside every sprint', async () => {
    const { svc, create } = build();
    await svc.create(user, fresh as Parameters<typeof svc.create>[1]);
    expect(createData(create)).toMatchObject({ sprintId: '', epicId: '' });
  });

  it('moves the task into the sprint and epic of the requirement it is moved under', async () => {
    const { svc, update } = planned('PLANNING', { functionalRequirementId: 'fr0', sprintId: '' });
    await svc.patch(user, 't1', { functionalRequirementId: 'fr1' });
    expect(updateData(update)).toMatchObject({
      functionalRequirementId: 'fr1',
      sprintId: 's1',
      epicId: 'e1',
    });
  });

  it('moves a task under a delivered requirement out of every sprint', async () => {
    const { svc, update } = planned('COMPLETED', { functionalRequirementId: 'fr0', sprintId: 's9' });
    await svc.patch(user, 't1', { functionalRequirementId: 'fr1' });
    expect(updateData(update)).toMatchObject({
      functionalRequirementId: 'fr1',
      sprintId: '',
      epicId: 'e1',
    });
  });

  it('still refuses to move a task into a closed sprint by name', async () => {
    const { svc, update } = planned('COMPLETED', { sprintId: '' });
    await expect(svc.patch(user, 't1', { sprintId: 's1' })).rejects.toThrow(
      'That sprint is completed.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  // Reopened inside a closed sprint, the task was open work that no sprint
  // would ever roll out again.
  it('takes a reopened task out of a sprint that has closed', async () => {
    const { svc, update } = planned('COMPLETED', { status: 'DONE', sprintId: 's1' });
    await svc.patch(user, 't1', { status: 'IN_PROGRESS' });
    expect(updateData(update)).toMatchObject({ status: 'IN_PROGRESS', sprintId: '' });
  });

  it('leaves a reopened task in a sprint that is still running', async () => {
    const { svc, update } = planned('ACTIVE', { status: 'DONE', sprintId: 's1' });
    await svc.patch(user, 't1', { status: 'IN_PROGRESS' });
    expect(updateData(update)).not.toHaveProperty('sprintId');
  });
});

describe('TasksService — hierarchy ids are allocated, not trusted', () => {
  const fresh = { workspaceId: 'w1', projectId: 'p1', hierarchyId: 'P-T-04', title: 'New' };
  const idOf = (create: jest.Mock, call = 0) =>
    (create.mock.calls[call][0].data as { hierarchyId: string }).hierarchyId;

  it('keeps the id the form proposed when it is free', async () => {
    const { svc, create } = build();
    await svc.create(user, fresh as Parameters<typeof svc.create>[1]);
    expect(idOf(create)).toBe('P-T-04');
  });

  // The form proposes `count + 1`, which a deleted task makes collide. The task
  // used to be refused; it takes the next free id.
  it('takes the next free id when the proposed one is in use', async () => {
    const { svc, create, taken } = build();
    taken.push('P-T-04', 'P-T-05');
    await svc.create(user, fresh as Parameters<typeof svc.create>[1]);
    expect(idOf(create)).toBe('P-T-06');
  });

  it('tries again when somebody else takes the id between the check and the insert', async () => {
    const { svc, create } = build();
    const lostRace = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['project_id', 'hierarchy_id'] },
    });
    Object.defineProperty(lostRace, 'constructor', {
      value: { name: 'PrismaClientKnownRequestError' },
    });
    create.mockRejectedValueOnce(lostRace);
    await svc.create(user, fresh as Parameters<typeof svc.create>[1]);
    expect(idOf(create, 1)).toBe('P-T-05');
  });
});

describe('TasksService — the parents are summed again by the server', () => {
  type Parents = Record<string, { findUnique: jest.Mock; update: jest.Mock }>;
  const fresh = { workspaceId: 'w1', projectId: 'p1', hierarchyId: 'P-T-01', title: 'New' };

  /** `total` tasks under the parent: `done` finished, `underway` started. */
  function counted(current: Partial<Task>, total: number, done: number, underway: number) {
    const built = build(current);
    (built.prisma.task.count as jest.Mock).mockImplementation(
      ({ where }: { where: { status?: unknown } }) =>
        Promise.resolve(where.status === 'DONE' ? done : where.status === undefined ? total : underway),
    );
    const parents = built.prisma as unknown as Parents;
    parents.functionalRequirement.findUnique.mockResolvedValue({
      projectId: 'p1',
      sprintId: '',
      epicId: 'e1',
      status: 'DRAFT',
      progress: 0,
    });
    return { ...built, parents };
  }

  it('a requirement that gets its first task is no longer a draft', async () => {
    const { svc, parents } = counted({}, 1, 0, 0);
    await svc.create(user, { ...fresh, functionalRequirementId: 'fr1' } as Parameters<
      typeof svc.create
    >[1]);
    expect(parents.functionalRequirement.update).toHaveBeenCalledWith({
      where: { id: 'fr1' },
      data: { progress: 0, status: 'APPROVED', version: { increment: 1 } },
    });
  });

  it('finishing a task moves its requirement and its epic', async () => {
    const { svc, parents } = counted(
      { status: 'REVIEW', functionalRequirementId: 'fr1', epicId: 'e1' },
      2,
      1,
      0,
    );
    await svc.patch(user, 't1', { status: 'DONE' });
    expect(parents.functionalRequirement.update).toHaveBeenCalledWith({
      where: { id: 'fr1' },
      data: { progress: 50, status: 'APPROVED', version: { increment: 1 } },
    });
    expect(parents.epic.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { progress: 50, status: 'IN_PROGRESS', version: { increment: 1 } },
    });
  });

  it('a task moved to another requirement re-sums the one it left as well', async () => {
    const { svc, parents } = counted({ functionalRequirementId: 'fr0', epicId: 'e1' }, 1, 0, 1);
    await svc.patch(user, 't1', { functionalRequirementId: 'fr1' });
    const summed = parents.functionalRequirement.update.mock.calls.map(
      ([args]) => (args as { where: { id: string } }).where.id,
    );
    expect(summed.sort()).toEqual(['fr0', 'fr1']);
  });

  it('an edit that changes neither status nor parent sums nothing', async () => {
    const { svc, parents, prisma } = counted({ functionalRequirementId: 'fr1' }, 1, 0, 0);
    await svc.patch(user, 't1', { title: 'renamed' });
    expect(prisma.task.count).not.toHaveBeenCalled();
    expect(parents.functionalRequirement.update).not.toHaveBeenCalled();
  });

  // The totals are bookkeeping about a save that has already happened.
  it('a roll-up that fails does not fail the save', async () => {
    const { svc, parents, update } = counted(
      { status: 'REVIEW', functionalRequirementId: 'fr1', epicId: 'e1' },
      1,
      1,
      0,
    );
    parents.functionalRequirement.update.mockRejectedValue(new Error('database went away'));
    await expect(svc.patch(user, 't1', { status: 'DONE' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
    // ...and the epic is still attempted.
    expect(parents.epic.update).toHaveBeenCalled();
  });
});

describe('TasksService — a drop is one write', () => {
  type Card = { id: string; position: number };
  /** The task being moved (t1, at position 5) and the other cards of its column. */
  function board(column: Card[], current: Partial<Task> = {}) {
    const built = build({ position: 5, ...current });
    const task = built.prisma.task as unknown as Record<string, jest.Mock>;
    task.findMany = jest.fn().mockResolvedValue(column);
    task.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const raw = built.prisma as unknown as Record<string, jest.Mock>;
    raw.$executeRaw = jest.fn().mockResolvedValue(1);
    raw.$transaction = jest.fn((body: (tx: unknown) => Promise<unknown>) => body(built.prisma));
    return { ...built, findMany: task.findMany, updateMany: task.updateMany, raw };
  }
  const written = (update: jest.Mock) => update.mock.calls[0][0].data as Record<string, unknown>;
  const column = [
    { id: 'a', position: 0 },
    { id: 'b', position: 1 },
    { id: 'c', position: 2 },
  ];

  it('lands halfway between the two cards it was dropped between, and writes nothing else', async () => {
    const { svc, update, updateMany } = board(column);
    await svc.patch(user, 't1', { placeBefore: 'c' });
    expect(written(update).position).toBe(1.5);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('reads the column it is moving INTO, in stored order', async () => {
    const { svc, findMany } = board(column);
    await svc.patch(user, 't1', { status: 'IN_PROGRESS', placeBefore: 'b' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', status: 'IN_PROGRESS', id: { not: 't1' } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('goes above the first card, and below the last for an empty anchor', async () => {
    const top = board(column);
    await top.svc.patch(user, 't1', { placeBefore: 'a' });
    expect(written(top.update).position).toBe(-1);
    const bottom = board(column);
    await bottom.svc.patch(user, 't1', { placeBefore: '' });
    expect(written(bottom.update).position).toBe(3);
  });

  // The card it was dropped in front of moved while this one was in the air.
  it('goes to the bottom when the anchor is no longer in the column', async () => {
    const { svc, update } = board(column);
    await svc.patch(user, 't1', { placeBefore: 'gone' });
    expect(written(update).position).toBe(3);
  });

  it('keeps its position in a column it has to itself', async () => {
    const { svc, update } = board([]);
    await svc.patch(user, 't1', { status: 'REVIEW', placeBefore: '' });
    expect(written(update).position).toBe(5);
  });

  it('wins over a position sent alongside it', async () => {
    const { svc, update } = board(column);
    await svc.patch(user, 't1', { placeBefore: 'b', position: 42 });
    expect(written(update).position).toBe(0.5);
  });

  // Rows from before positions were spread out can share one; there is no
  // number between two equal ones, so the column is renumbered first.
  it('renumbers the column, in its order, when there is no room left', async () => {
    const tied = [
      { id: 'a', position: 0 },
      { id: 'b', position: 0 },
      { id: 'c', position: 0 },
    ];
    const { svc, update, updateMany, raw } = board(tied);
    await svc.patch(user, 't1', { placeBefore: 'b' });
    expect(raw.$transaction).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls.map(([args]) => [args.where.id, args.data.position])).toEqual([
      ['a', 0],
      ['b', 2],
      ['c', 3],
    ]);
    expect(written(update).position).toBe(1);
  });

  it('asks for the right to move the card before making room for it', async () => {
    const { svc, access, updateMany } = board([
      { id: 'a', position: 0 },
      { id: 'b', position: 0 },
    ]);
    (access.assertPermission as jest.Mock).mockRejectedValue(new Error('denied'));
    await expect(svc.patch(user, 't1', { placeBefore: 'b' })).rejects.toThrow('denied');
    expect(updateMany).not.toHaveBeenCalled();
  });

  const fresh = { workspaceId: 'w1', projectId: 'p1', hierarchyId: 'P-T-01', title: 'New' };

  it('a new task goes one past the highest position in the project, not the task count', async () => {
    const { svc, create, prisma } = build();
    (prisma.task.aggregate as jest.Mock).mockResolvedValue({ _max: { position: 41.5 } });
    await svc.create(user, fresh as never);
    expect(create.mock.calls[0][0].data.position).toBe(42);
  });

  it('the first task in a project is at 0', async () => {
    const { svc, create } = build();
    await svc.create(user, fresh as never);
    expect(create.mock.calls[0][0].data.position).toBe(0);
  });
});

describe('TasksService — the activity trail', () => {
  function audited(current: Partial<Task> = {}) {
    const built = build(current);
    const activityLog = { create: jest.fn().mockResolvedValue({}) };
    (built.prisma as unknown as Record<string, unknown>).activityLog = activityLog;
    return { ...built, logged: activityLog.create };
  }

  it('does not record a card moved within its column', async () => {
    const { svc, logged } = audited();
    await svc.patch(user, 't1', { position: 4 });
    expect(logged).not.toHaveBeenCalled();
  });

  it('still records a move to another column, and any other edit', async () => {
    const moved = audited();
    await moved.svc.patch(user, 't1', { status: 'IN_PROGRESS', position: 4 });
    expect(moved.logged).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'task.updated' }) }),
    );
    const renamed = audited();
    await renamed.svc.patch(user, 't1', { title: 'Renamed' });
    expect(renamed.logged).toHaveBeenCalled();
  });
});

describe('TasksService.summary — overdue is by the due DAY, in the workspace zone', () => {
  afterEach(() => jest.useRealTimers());

  function summarised(timezone: string) {
    const queryRaw = jest.fn().mockResolvedValue([
      { user_id: 'u2', total: BigInt(3), done: BigInt(1), overdue: BigInt(1) },
    ]);
    const prisma = {
      workspace: { findUnique: jest.fn().mockResolvedValue({ settings: { timezone } }) },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const access = {
      assertMember: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceAccessService;
    return { svc: new TasksService(prisma, access, noEvents), queryRaw };
  }

  it("compares the due date's calendar day there with today there", async () => {
    // 20:00 UTC on the 12th is already the 13th in India.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-12T20:00:00.000Z'));
    const { svc, queryRaw } = summarised('Asia/Kolkata');
    await svc.summary(user, 'w1');
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('?');
    // A due date stored as India's midnight on the 13th (18:30 UTC on the 12th)
    // falls ON the 13th — today — so it is not counted overdue.
    expect(sql).toMatch(
      /\(\(t\.due_date AT TIME ZONE 'UTC'\) AT TIME ZONE \?::text\)::date\s+< \?::date/,
    );
    expect(values).toEqual(['Asia/Kolkata', '2026-11-13', 'w1']);
  });

  it('reports the counts it was given', async () => {
    const { svc } = summarised('UTC');
    await expect(svc.summary(user, 'w1')).resolves.toEqual({
      byAssignee: [
        { userId: 'u2', totalTasks: 3, activeTasks: 2, completedTasks: 1, overdueTasks: 1 },
      ],
    });
  });

  it("leaves an archived project's leftovers off everybody's load", async () => {
    const { svc, queryRaw } = summarised('UTC');
    await svc.summary(user, 'w1');
    const [strings] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM projects_project p\s+WHERE p\.id = t\.project_id AND p\.status = 'ARCHIVED'\s*\)/,
    );
  });
});

describe('TasksService dependency edges — an archived project at one end', () => {
  it('draws no new edge onto a task of an archived project', async () => {
    const { svc, rows } = buildGraph({ t1: {}, t2: { projectId: 'p2' } }, ['p2']);
    await expect(
      svc.addDependency(user, 't1', { targetTaskId: 't2', type: 'blockedBy' }),
    ).rejects.toThrow('This project is archived. Unarchive it to make changes.');
    expect(rows.get('t1')!.blockedBy).toEqual([]);
    expect(rows.get('t2')!.blocks).toEqual([]);
  });

  it('still takes an edge off an open task when the far end has been archived', async () => {
    const { svc, rows } = buildGraph(
      { t1: { blockedBy: ['t2'] }, t2: { projectId: 'p2', blocks: ['t1'] } },
      ['p2'],
    );
    await svc.removeDependency(user, 't1', 't2', 'blockedBy');
    expect(rows.get('t1')!.blockedBy).toEqual([]);
    expect(rows.get('t2')!.blocks).toEqual([]);
  });

  it('changes nothing on a task of an archived project, from its own side', async () => {
    const { svc, rows } = buildGraph(
      { t1: { blockedBy: ['t2'] }, t2: { projectId: 'p2', blocks: ['t1'] } },
      ['p2'],
    );
    await expect(svc.removeDependency(user, 't2', 't1', 'blocks')).rejects.toThrow(
      'This project is archived. Unarchive it to make changes.',
    );
    expect(rows.get('t2')!.blocks).toEqual(['t1']);
  });
});

describe('TasksService — an edge to a task that has been deleted', () => {
  it('can still be removed, from the side that is left', async () => {
    const { svc, rows } = buildGraph({ t1: { blockedBy: ['gone', 't2'] }, t2: { blocks: ['t1'] } });
    await svc.removeDependency(user, 't1', 'gone', 'blockedBy');
    expect(rows.get('t1')!.blockedBy).toEqual(['t2']);
    expect(rows.get('t2')!.blocks).toEqual(['t1']);
  });

  it("is still a 404 when the other task exists but is not the caller's to see", async () => {
    const { svc, prisma, rows } = buildGraph({ t1: { blocks: ['hidden'] } });
    // The scoped read cannot see it; the unscoped lookup can.
    (prisma.task as { findUnique: jest.Mock }).findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'hidden' ? { id: 'hidden' } : (rows.get(where.id) ?? null)),
    );
    await expect(svc.removeDependency(user, 't1', 'hidden', 'blocks')).rejects.toThrow(
      'Not found.',
    );
    expect(rows.get('t1')!.blocks).toEqual(['hidden']);
  });

  it('is still a 404 to ADD an edge to a task that does not exist', async () => {
    const { svc } = buildGraph({ t1: {} });
    await expect(
      svc.addDependency(user, 't1', { targetTaskId: 'gone', type: 'blockedBy' }),
    ).rejects.toThrow('Not found.');
  });
});
