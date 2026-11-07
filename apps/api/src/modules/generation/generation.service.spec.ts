import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { GenerationService } from './generation.service';
import { HierarchyIdService } from './hierarchy-id.service';
import type { BulkSaveDto } from './dto';

const user = { id: 'u1', name: 'Dev' } as User;

/** A table inside the save's transaction: the whole tree arrives in one createMany each. */
function delegate(extra: Record<string, jest.Mock> = {}) {
  return {
    createMany: jest.fn(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    ...extra,
  };
}

/** The rows a save inserted into one table, in order (typed as loosely as `mock.calls`). */
const inserted = (table: { createMany: jest.Mock }) =>
  table.createMany.mock.calls.flatMap(([args]) => args.data);

/** A table as read after the commit: the rows asked for, by id. */
const committed = () => ({
  findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.map((id) => ({ id, workspaceId: 'w1' }))),
  ),
});

function buildPrisma(prior: unknown = null, project: Record<string, unknown> = {}) {
  const tx = {
    clientRequirement: delegate(),
    epic: delegate(),
    functionalRequirement: delegate(),
    task: delegate(),
  };
  const prisma = {
    idempotencyKey: {
      // Real row shape is { key, response }; the service returns row.response.
      findUnique: jest.fn().mockResolvedValue(prior ? { key: 'k', response: prior } : null),
      create: jest.fn().mockResolvedValue({}),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ clientName: 'Acme', workspaceId: 'w1', ...project }),
    },
    workspace: { findUnique: jest.fn().mockResolvedValue({ id: 'w1' }) },
    clientRequirement: committed(),
    epic: committed(),
    functionalRequirement: committed(),
    task: committed(),
    // The audit trail of the saved tree, written in one insert after the commit.
    activityLog: {
      createManyAndReturn: jest.fn(({ data }: { data: unknown[] }) => Promise.resolve(data)),
    },
    announceWrite: jest.fn(),
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, tx };
}

/** The audit entries one save wrote. */
const trail = (prisma: PrismaService) =>
  (prisma as unknown as { activityLog: { createManyAndReturn: jest.Mock } }).activityLog
    .createManyAndReturn;

const access = { assertPermission: jest.fn().mockResolvedValue(undefined) };

/** `$transaction` is typed as an overloaded method; the double is a plain jest.fn. */
const $transactionOf = (prisma: PrismaService) =>
  (prisma as unknown as { $transaction: jest.Mock }).$transaction;

const dto: BulkSaveDto = {
  projectId: 'p1',
  workspaceId: 'w1',
  projectCode: 'PROJ',
  generated: {
    clientRequirements: [{ title: 'User Auth', description: '' }],
    epics: [{ name: 'Login Flow' }],
    functionalRequirements: [{ title: 'API Endpoint' }],
    tasks: [{ title: 'Write tests', priority: 'high' }],
  },
};

describe('GenerationService.bulkSave', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the CR→Epic→FR→Task tree with the exact hierarchy ids', async () => {
    const { prisma } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, dto)) as {
      success: boolean;
      clientRequirements: { hierarchyId: string; id: string }[];
      epics: { hierarchyId: string; id: string; requirementId: string; crCode: string }[];
      functionalRequirements: { hierarchyId: string; epicId: string }[];
      tasks: { hierarchyId: string }[];
    };

    expect(res.success).toBe(true);
    expect(res.clientRequirements[0].hierarchyId).toBe('PROJ-USE-01');
    expect(res.epics[0].hierarchyId).toBe('PROJ-USE-LOG-01');
    expect(res.epics[0].crCode).toBe('USE');
    expect(res.functionalRequirements[0].hierarchyId).toBe('PROJ-USE-LOG-API-01');
    expect(res.tasks[0].hierarchyId).toBe('PROJ-WRI-01');
    // links are threaded through
    expect(res.epics[0].requirementId).toBe(res.clientRequirements[0].id);
    expect(res.functionalRequirements[0].epicId).toBe(res.epics[0].id);
  });

  it('uppercases priority and defaults it to MEDIUM', async () => {
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());
    await svc.bulkSave(user, dto);
    expect(inserted(tx.task)[0].priority).toBe('HIGH');
  });

  // Created one row at a time, every insert was announced by the realtime write
  // hook inside the transaction — before the commit — so open screens refetched
  // a tree that was not there yet (or, after a rollback, never would be).
  it('inserts each table in one createMany and announces the tree only once it has committed', async () => {
    const { prisma, tx } = buildPrisma();
    const announceWrite = (prisma as unknown as { announceWrite: jest.Mock }).announceWrite;
    let announcedInside = -1;
    $transactionOf(prisma).mockImplementation(async (cb: (t: typeof tx) => unknown) => {
      const out = await cb(tx);
      announcedInside = announceWrite.mock.calls.length;
      return out;
    });
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, dto)) as {
      clientRequirements: { id: string }[];
      tasks: { id: string }[];
    };

    for (const table of [tx.clientRequirement, tx.epic, tx.functionalRequirement, tx.task]) {
      expect(table.createMany).toHaveBeenCalledTimes(1);
    }
    expect(announcedInside).toBe(0);
    expect(announceWrite.mock.calls.map(([model, action]) => `${model}.${action}`)).toEqual([
      'ClientRequirement.create',
      'Epic.create',
      'FunctionalRequirement.create',
      'Task.create',
      // One frame for the whole trail: every open Activity screen refetches once.
      'ActivityLog.create',
    ]);
    expect(announceWrite).toHaveBeenCalledWith('Task', 'create', expect.objectContaining({ id: res.tasks[0].id }));
  });

  it('gives the transaction longer than Prisma’s 5-second default', async () => {
    const { prisma } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());
    await svc.bulkSave(user, dto);
    expect($transactionOf(prisma).mock.calls[0][1]).toEqual({ timeout: 60_000 });
  });

  // Nothing of the batch is in the table until the end, so the free-id probe
  // has to remember what the batch itself has numbered.
  it('never gives two rows of one save the same hierarchy id', async () => {
    const { prisma, tx } = buildPrisma();
    // The natural id of the first task is taken in the table: it moves to -02,
    // which is the natural id of the second task.
    (tx.task.findFirst as jest.Mock).mockImplementation((args: { where: { hierarchyId: string } }) =>
      Promise.resolve(args.where.hierarchyId === 'PROJ-WRI-01' ? { id: 'existing' } : null),
    );
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await svc.bulkSave(user, {
      ...dto,
      generated: { ...dto.generated, tasks: [{ title: 'Write tests' }, { title: 'Write docs' }] },
    });

    expect(inserted(tx.task).map((row) => row.hierarchyId)).toEqual(['PROJ-WRI-02', 'PROJ-WRI-03']);
  });

  it('is retry-safe: a known Idempotency-Key returns the stored response', async () => {
    const stored = { success: true, cached: true };
    const { prisma } = buildPrisma(stored);
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = await svc.bulkSave(user, dto, 'key-123');

    expect(res).toEqual(stored);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // Authorization runs BEFORE the replay — the stored body is a list of ids.
    expect(access.assertPermission).toHaveBeenCalledWith(user, 'w1', 'requirement:write');
    // ...and the lookup key is namespaced by caller + workspace, so one tenant's
    // key can never replay another tenant's response.
    expect(prisma.idempotencyKey.findUnique).toHaveBeenCalledWith({
      where: { key: 'u1:w1:key-123' },
    });
  });

  it('rejects a project that belongs to another workspace', async () => {
    const { prisma } = buildPrisma(null, { workspaceId: 'other-ws' });
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await expect(svc.bulkSave(user, dto)).rejects.toThrow(/does not belong to this workspace/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('files nothing into an archived project', async () => {
    const { prisma } = buildPrisma(null, { status: 'ARCHIVED' });
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await expect(svc.bulkSave(user, dto)).rejects.toThrow(
      'This project is archived. Unarchive it to make changes.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(trail(prisma)).not.toHaveBeenCalled();
  });

  it('leaves a trail of what it saved, as the create routes do, marked as generated', async () => {
    const { prisma } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, dto)) as {
      clientRequirements: { id: string }[];
      epics: { id: string }[];
      functionalRequirements: { id: string }[];
      tasks: { id: string }[];
    };

    expect(trail(prisma)).toHaveBeenCalledTimes(1);
    const [{ data }] = trail(prisma).mock.calls[0] as [{ data: Array<Record<string, unknown>> }];
    expect(data).toEqual([
      expect.objectContaining({
        workspaceId: 'w1',
        userId: 'u1',
        action: 'client_requirement.created',
        entityType: 'client_requirement',
        entityId: res.clientRequirements[0].id,
        metadata: { label: 'User Auth', source: 'ai_generation' },
      }),
      expect.objectContaining({ action: 'epic.created', entityId: res.epics[0].id, metadata: { label: 'Login Flow', source: 'ai_generation' } }),
      expect.objectContaining({
        action: 'functional_requirement.created',
        entityId: res.functionalRequirements[0].id,
        metadata: { label: 'API Endpoint', source: 'ai_generation' },
      }),
      expect.objectContaining({ action: 'task.created', entityId: res.tasks[0].id, metadata: { label: 'Write tests', source: 'ai_generation' } }),
    ]);
  });

  it('is saved even when its trail cannot be written', async () => {
    const { prisma } = buildPrisma();
    trail(prisma).mockRejectedValueOnce(new Error('trail down'));
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await expect(svc.bulkSave(user, dto)).resolves.toMatchObject({ success: true });
  });

  it('stamps authorship from the authenticated caller, never from the body', async () => {
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await svc.bulkSave(user, { ...dto, userId: 'someone-else' } as BulkSaveDto);

    expect(inserted(tx.clientRequirement)[0].createdById).toBe('u1');
  });

  it('takes the next free hierarchy id instead of dropping a colliding FR', async () => {
    // Regression: a collision used to `continue`, which silently dropped the FR,
    // orphaned its children and shifted every task's round-robin link.
    const { prisma, tx } = buildPrisma();
    (tx.functionalRequirement.findFirst as jest.Mock).mockImplementation(
      (args: { where: { hierarchyId: string } }) =>
        Promise.resolve(args.where.hierarchyId === 'PROJ-USE-LOG-API-01' ? { id: 'existing' } : null),
    );
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, dto)) as {
      functionalRequirements: { hierarchyId: string }[];
      tasks: { hierarchyId: string }[];
    };

    expect(res.functionalRequirements).toHaveLength(1);
    expect(res.functionalRequirements[0].hierarchyId).toBe('PROJ-USE-LOG-API-02');
    expect(res.tasks).toHaveLength(1); // the task still finds an FR to link to
  });

  it('rebuilds the tree once when the unique index rejects a raced insert', async () => {
    const { prisma } = buildPrisma();
    const conflict = new Error('Unique constraint failed') as Error & { code: string };
    conflict.code = 'P2002';
    Object.defineProperty(conflict, 'constructor', {
      value: { name: 'PrismaClientKnownRequestError' },
    });
    ($transactionOf(prisma) as jest.Mock).mockRejectedValueOnce(conflict);
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, dto)) as { success: boolean };

    expect(res.success).toBe(true);
    expect($transactionOf(prisma)).toHaveBeenCalledTimes(2);
  });

  it('honours the epic→FR and task→epic links the model drew', async () => {
    // Regression: both link sets were discarded and every node re-parented
    // round-robin by array position, so the SAVED tree bore no relation to the
    // preview the user had just confirmed.
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }],
        // Epics reference FRs by TITLE, which is what the model actually emits.
        epics: [
          { name: 'Alpha', functionalRequirementIds: ['Second FR'] },
          { name: 'Beta', functionalRequirementIds: ['First FR'] },
        ],
        functionalRequirements: [{ title: 'First FR' }, { title: 'Second FR' }],
        // ...and tasks reference epics by index or by name, both of which occur.
        tasks: [
          { title: 'Task One', epicId: 1 },
          { title: 'Task Two', epicId: 'Alpha' },
        ],
      },
    })) as {
      epics: { id: string }[];
      functionalRequirements: { id: string; epicId: string; hierarchyId: string }[];
    };

    const [alpha, beta] = res.epics;
    // Round-robin filed FR #0 under Alpha and FR #1 under Beta — the exact swap.
    expect(res.functionalRequirements[0].epicId).toBe(beta.id);
    expect(res.functionalRequirements[1].epicId).toBe(alpha.id);
    // The epic's code is embedded in the FR's hierarchy id, so the wrong parent
    // used to be baked into the human-facing id too.
    expect(res.functionalRequirements[1].hierarchyId).toBe('PROJ-USE-ALP-SEC-02');

    const taskRows = inserted(tx.task);
    expect(taskRows[0].epicId).toBe(beta.id);
    expect(taskRows[0].functionalRequirementId).toBe(res.functionalRequirements[0].id);
    expect(taskRows[1].epicId).toBe(alpha.id);
    expect(taskRows[1].functionalRequirementId).toBe(res.functionalRequirements[1].id);
  });

  it('puts an epic under the client requirement it names, and a task under its named requirement', async () => {
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }, { title: 'Payments' }],
        // By position the first epic would go under "User Auth"; it says Payments.
        epics: [
          { name: 'Checkout', clientRequirementId: '1', functionalRequirementIds: ['0', '1'] },
          { name: 'Login', clientRequirementId: 'User Auth', functionalRequirementIds: [] },
        ],
        functionalRequirements: [{ title: 'Card form' }, { title: 'Receipt' }],
        // Two tasks on the same epic: the cursor would give the first to the
        // first requirement; each names its own.
        tasks: [
          { title: 'Send the receipt', epicId: 0, functionalRequirementId: '1' },
          { title: 'Build the form', epicId: 0, functionalRequirementId: 'Card form' },
        ],
      },
    })) as {
      clientRequirements: { id: string }[];
      epics: { id: string; requirementId: string }[];
      functionalRequirements: { id: string; epicId: string }[];
    };

    const [auth, payments] = res.clientRequirements;
    expect(res.epics[0].requirementId).toBe(payments.id);
    expect(res.epics[1].requirementId).toBe(auth.id);
    const taskRows = inserted(tx.task);
    expect(taskRows[0].functionalRequirementId).toBe(res.functionalRequirements[1].id);
    expect(taskRows[1].functionalRequirementId).toBe(res.functionalRequirements[0].id);
    expect(taskRows.every((row) => row.epicId === res.epics[0].id)).toBe(true);
  });

  it('files an FR no epic claimed under the emptiest epic, not the next in rotation', async () => {
    // Residual: honouring the declared links left the UNCLAIMED FRs on the old
    // `i % epics.length` rotation, which is no longer disjoint from the honoured
    // assignments — a stray FR could land on an epic that already owns declared
    // ones, i.e. the original finding in a narrower form.
    const { prisma } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }],
        epics: [{ name: 'Alpha', functionalRequirementIds: ['FR B'] }, { name: 'Beta' }],
        functionalRequirements: [{ title: 'FR A' }, { title: 'FR B' }],
        tasks: [],
      },
    })) as { epics: { id: string }[]; functionalRequirements: { epicId: string }[] };

    const [alpha, beta] = res.epics;
    // Rotation would have put FR A (i=0) on Alpha, which already owns FR B.
    expect(res.functionalRequirements[0].epicId).toBe(beta.id);
    expect(res.functionalRequirements[1].epicId).toBe(alpha.id);
  });

  it('keeps a task on its named epic with no FR rather than borrowing another epic\'s', async () => {
    // Residual: a named epic that owns no FRs still took an FR from the global
    // rotation, so Task.epicId and the epic of Task.functionalRequirementId
    // pointed at two DIFFERENT epics on the same row.
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }],
        epics: [{ name: 'Alpha', functionalRequirementIds: ['Only FR'] }, { name: 'Beta' }],
        functionalRequirements: [{ title: 'Only FR' }],
        tasks: [{ title: 'Beta work', epicId: 'Beta' }],
      },
    })) as { epics: { id: string }[]; functionalRequirements: { id: string; epicId: string }[] };

    const [alpha, beta] = res.epics;
    expect(res.functionalRequirements[0].epicId).toBe(alpha.id);

    const taskRow = inserted(tx.task)[0];
    expect(taskRow.epicId).toBe(beta.id);
    expect(taskRow.functionalRequirementId).toBe('');
  });

  it('resolves an approximately-quoted epic name instead of re-homing the task', async () => {
    // Residual: the model quotes a title back only approximately ("Beta" for
    // "Beta Epic", "Epic 2: Beta Epic" for the same thing). Every near-miss
    // resolved to null, which the task loop could not tell apart from "named no
    // epic", so the global rotation filed the task under a DIFFERENT epic and
    // handed it that epic's FR — the cross-epic borrow, one step removed.
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }],
        epics: [
          { name: 'Alpha Epic', functionalRequirementIds: ['FR One'] },
          { name: 'Beta Epic', functionalRequirementIds: ['FR Two'] },
        ],
        functionalRequirements: [{ title: 'FR One' }, { title: 'FR Two' }],
        tasks: [
          { title: 'Loose name', epicId: 'Beta' },
          { title: 'Decorated', epicId: 'Epic 2: Beta Epic' },
          { title: 'Parenthesised', epicId: 'Alpha Epic (auth)' },
        ],
      },
    })) as { epics: { id: string }[]; functionalRequirements: { id: string; epicId: string }[] };

    const [alpha, beta] = res.epics;
    const rows = inserted(tx.task);
    expect(rows.map((row) => row.epicId)).toEqual([beta.id, beta.id, alpha.id]);
    // ...and each one gets an FR from the epic it actually named.
    const epicOfFr = new Map(res.functionalRequirements.map((fr) => [fr.id, fr.epicId]));
    for (const row of rows) expect(epicOfFr.get(row.functionalRequirementId)).toBe(row.epicId);
  });

  it('refuses to guess when a partial epic name fits two epics', async () => {
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }],
        epics: [
          { name: 'Beta Login', functionalRequirementIds: ['FR One'] },
          { name: 'Beta Payments', functionalRequirementIds: ['FR Two'] },
        ],
        functionalRequirements: [{ title: 'FR One' }, { title: 'FR Two' }],
        tasks: [{ title: 'Ambiguous', epicId: 'Beta' }],
      },
    });

    // "Beta" fits both epics. A coin-flip parent is worse than none, and the
    // old rotation fallback would have asserted one AND lent it that epic's FR.
    const row = inserted(tx.task)[0];
    expect(row.epicId).toBe('');
    expect(row.functionalRequirementId).toBe('');
  });

  it('still rotates a task that named no epic at all across the FRs', async () => {
    // The unresolvable-ref guard must not take the rotation away from a task
    // the model left unattached: it names no epic, so no link is contradicted.
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }],
        epics: [{ name: 'Alpha', functionalRequirementIds: ['FR One', 'FR Two'] }],
        functionalRequirements: [{ title: 'FR One' }, { title: 'FR Two' }],
        tasks: [{ title: 'Stray one' }, { title: 'Stray two' }],
      },
    })) as { epics: { id: string }[]; functionalRequirements: { id: string }[] };

    const rows = inserted(tx.task);
    expect(rows.map((row) => row.functionalRequirementId)).toEqual([
      res.functionalRequirements[0].id,
      res.functionalRequirements[1].id,
    ]);
    expect(rows.every((row) => row.epicId === res.epics[0].id)).toBe(true);
  });

  it('reads epicId 0 as the first epic, not as "no epic named"', async () => {
    // `0` is falsy; the supplied-ref test has to be a type check, or the first
    // epic becomes unaddressable by index.
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    const res = (await svc.bulkSave(user, {
      ...dto,
      generated: {
        clientRequirements: [{ title: 'User Auth' }],
        epics: [{ name: 'Alpha', functionalRequirementIds: ['FR One'] }, { name: 'Beta' }],
        functionalRequirements: [{ title: 'FR One' }],
        tasks: [{ title: 'First epic', epicId: 0 }],
      },
    })) as { epics: { id: string }[]; functionalRequirements: { id: string }[] };

    const row = inserted(tx.task)[0];
    expect(row.epicId).toBe(res.epics[0].id);
    expect(row.functionalRequirementId).toBe(res.functionalRequirements[0].id);
  });

  it('links generated child FRs to their parent with parentRequirementId', async () => {
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await svc.bulkSave(user, {
      ...dto,
      generated: {
        ...dto.generated,
        functionalRequirements: [
          { title: 'API Endpoint' },
          { title: 'Child', parentId: 'fr-0' },
          { title: 'Second child', parentId: 'fr-0' },
        ],
      },
    });

    const [parent, child, second] = inserted(tx.functionalRequirement);
    expect(child.parentRequirementId).toBe(parent.id);
    // Under its parent's epic and client requirement, read off the batch.
    expect(child.epicId).toBe(parent.epicId);
    expect(child.clientRequirementId).toBe(parent.clientRequirementId);
    expect(child.hierarchyId).toBe('PROJ-USE-LOG-API-01.01');
    // Numbered after the sibling this same save made.
    expect(second.hierarchyId).toBe('PROJ-USE-LOG-API-01.02');
  });
});
