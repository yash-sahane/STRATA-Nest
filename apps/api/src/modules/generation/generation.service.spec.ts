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

function buildPrisma(prior: unknown = null) {
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
    project: { findUnique: jest.fn().mockResolvedValue({ clientName: 'Acme' }) },
    workspace: { findUnique: jest.fn().mockResolvedValue({ id: 'w1' }) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, tx };
}

const access = { assertMember: jest.fn().mockResolvedValue(undefined) };

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
    expect(access.assertMember).not.toHaveBeenCalled();
  });
});
