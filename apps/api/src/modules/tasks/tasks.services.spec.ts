import { parseListQuery } from '@strata/common';
import type { PrismaService } from '@strata/prisma';
import type { Task, User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TasksService } from './tasks.services';

const user = { id: 'u1', name: 'U' } as User;

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
  assignedBy: '',
  assignedByName: '',
  assignedTo: [],
  assignedToNames: [],
  watcherIds: [],
  createdById: 'u1',
  createdByName: 'U',
  dueDate: null,
  estimatedHours: null,
  actualHours: null,
  labels: [],
  attachments: [],
  customFields: {},
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
  const sibling = () => ({ findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }) });
  const prisma = {
    task: { update, create, findFirst: jest.fn().mockResolvedValue(row), findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }) },
    // namesFor() resolves assignee display names from here — a name is not
    // derivable from an id, so the service has to look it up.
    user: { findMany: jest.fn().mockResolvedValue([]) },
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
  return { svc: new TasksService(prisma, access), update, create, access, project, prisma };
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

describe('TasksService assignee mirroring', () => {
  it('mirrors assignedTo into assigneeIds when only one side is sent', async () => {
    const { svc, create } = build();
    await svc.create(user, {
      workspaceId: 'w1',
      projectId: 'p1',
      hierarchyId: 'ABC-T03',
      title: 'T',
      assignedTo: ['u2'],
    });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.assigneeIds).toEqual(['u2']);
    expect(data.assignedTo).toEqual(['u2']);
  });

  it('mirrors assigneeIds into assignedTo when only one side is sent', async () => {
    const { svc, create } = build();
    await svc.create(user, {
      workspaceId: 'w1',
      projectId: 'p1',
      hierarchyId: 'ABC-T04',
      title: 'T',
      assigneeIds: ['u3'],
    });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.assigneeIds).toEqual(['u3']);
    expect(data.assignedTo).toEqual(['u3']);
  });
});

/** In-memory task graph for the dependency tests (findFirst/findMany/update). */
function buildGraph(seed: Record<string, Partial<Task>>) {
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
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  return { svc: new TasksService(prisma, access), rows, prisma };
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
    const spec = (new TasksService({} as PrismaService, {} as WorkspaceAccessService) as unknown as {
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
    const spec = (new TasksService({} as PrismaService, {} as WorkspaceAccessService) as unknown as {
      spec: Parameters<typeof parseListQuery>[1];
    }).spec;
    expect(parseListQuery({ ordering: 'dueDate' }, spec).orderBy).toEqual([{ dueDate: 'asc' }]);
  });
});
