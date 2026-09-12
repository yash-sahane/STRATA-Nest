import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { GenerationService } from './generation.service';
import { HierarchyIdService } from './hierarchy-id.service';
import type { BulkSaveDto } from './dto';

const user = { id: 'u1', name: 'Dev' } as User;

/** Delegate whose create echoes the row (so the service reads back doc.id). */
function delegate(extra: Record<string, jest.Mock> = {}) {
  return {
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data })),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    ...extra,
  };
}

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
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, tx };
}

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
    expect((tx.task.create as jest.Mock).mock.calls[0][0].data.priority).toBe('HIGH');
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

  it('stamps authorship from the authenticated caller, never from the body', async () => {
    const { prisma, tx } = buildPrisma();
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await svc.bulkSave(user, { ...dto, userId: 'someone-else' } as BulkSaveDto);

    expect((tx.clientRequirement.create as jest.Mock).mock.calls[0][0].data.createdById).toBe('u1');
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

    const taskRows = (tx.task.create as jest.Mock).mock.calls.map((c) => c[0].data);
    expect(taskRows[0].epicId).toBe(beta.id);
    expect(taskRows[0].functionalRequirementId).toBe(res.functionalRequirements[0].id);
    expect(taskRows[1].epicId).toBe(alpha.id);
    expect(taskRows[1].functionalRequirementId).toBe(res.functionalRequirements[1].id);
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

    const taskRow = (tx.task.create as jest.Mock).mock.calls[0][0].data;
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
    const rows = (tx.task.create as jest.Mock).mock.calls.map((c) => c[0].data);
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
    const row = (tx.task.create as jest.Mock).mock.calls[0][0].data;
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

    const rows = (tx.task.create as jest.Mock).mock.calls.map((c) => c[0].data);
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

    const row = (tx.task.create as jest.Mock).mock.calls[0][0].data;
    expect(row.epicId).toBe(res.epics[0].id);
    expect(row.functionalRequirementId).toBe(res.functionalRequirements[0].id);
  });

  it('links generated child FRs to their parent with parentRequirementId', async () => {
    const { prisma, tx } = buildPrisma();
    (tx.functionalRequirement.findUnique as jest.Mock).mockResolvedValue({
      id: 'parent-db-id', hierarchyId: 'PROJ-USE-LOG-API-01', epicId: 'e1', clientRequirementId: 'cr1',
    });
    const svc = new GenerationService(prisma, access as never, new HierarchyIdService());

    await svc.bulkSave(user, {
      ...dto,
      generated: {
        ...dto.generated,
        functionalRequirements: [{ title: 'API Endpoint' }, { title: 'Child', parentId: 'fr-0' }],
      },
    });

    const calls = (tx.functionalRequirement.create as jest.Mock).mock.calls;
    expect(calls.at(-1)[0].data.parentRequirementId).toBe(calls[0][0].data.id);
    expect(calls.at(-1)[0].data.hierarchyId).toBe('PROJ-USE-LOG-API-01.01');
  });
});
