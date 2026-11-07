import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { FunctionalRequirementsService } from './requirements.services';
import type { CreateFunctionalRequirementDto, UpdateFunctionalRequirementDto } from './dto';

const user = { id: 'u1', name: 'Dev' } as User;
const access = {
  assertPermission: jest.fn().mockResolvedValue(undefined),
  isPlatformAdmin: () => true,
  scopeWhere: jest.fn().mockResolvedValue({}),
} as never;

const baseCreate: CreateFunctionalRequirementDto = {
  workspaceId: 'w1',
  projectId: 'p1',
  hierarchyId: 'P-A-B-C-01',
  title: 'Login API',
};

/**
 * A P2002 the way Prisma raises it — real Prisma errors aren't constructible
 * without a client, and both the exception filter and the hierarchy-id
 * allocator duck-type the class name (see all-exceptions.filter.spec.ts).
 */
class FakeUniqueViolation extends Error {
  code = 'P2002';
  meta = { target: ['project_id', 'hierarchy_id'] };
  constructor() {
    super('Unique constraint failed');
    Object.defineProperty(this, 'constructor', {
      value: { name: 'PrismaClientKnownRequestError' },
    });
  }
}

/**
 * Prisma double: every lookup is overridable per test; unset rows resolve to null.
 * `rows.taken` lists hierarchy ids already used in the project, so the
 * allocator's probe can be driven; `rows.createFailsOnce` makes the first insert
 * lose the race with a concurrent create.
 */
function buildPrisma(rows: Record<string, unknown> = {}) {
  const row = (v: unknown) => ({ findUnique: jest.fn().mockResolvedValue(v ?? null) });
  const stamps = { createdAt: new Date(0), updatedAt: new Date(0) }; // the mapper formats both
  const taken = (rows.taken as string[]) ?? [];
  let createFailures = rows.createFailsOnce ? 1 : 0;
  return {
    project: row(rows.project ?? { workspaceId: 'w1' }),
    epic: row(rows.epic),
    sprint: row(rows.sprint),
    clientRequirement: row(rows.clientRequirement),
    // What RequirementTasks reads and writes when a requirement moves. One
    // existing task by default, so a move re-points rather than creates.
    task: {
      count: jest.fn().mockResolvedValue(rows.taskCount ?? 1),
      findMany: jest.fn().mockResolvedValue(rows.tasks ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    announceWrite: jest.fn(),
    functionalRequirement: {
      // An epic's roll-up also counts its requirements that have no task yet.
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(rows.parent ?? null),
      findFirst: jest.fn((args: { where?: { hierarchyId?: unknown } }) => {
        // The hierarchy-id probe asks for one exact id; everything else is findScoped.
        const hierarchyId = args?.where?.hierarchyId;
        if (typeof hierarchyId === 'string') {
          return Promise.resolve(taken.includes(hierarchyId) ? { id: 'other' } : null);
        }
        return Promise.resolve(rows.self ?? { id: 'fr1', workspaceId: 'w1', projectId: 'p1' });
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...stamps, ...data }),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (createFailures > 0) {
          createFailures -= 1;
          return Promise.reject(new FakeUniqueViolation());
        }
        return Promise.resolve({ ...stamps, ...data });
      }),
    },
  } as unknown as PrismaService;
}

const emit = jest.fn();
const svcWith = (prisma: PrismaService) =>
  new FunctionalRequirementsService(prisma, access, { emit } as never);

describe('FunctionalRequirementsService.create — scope guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a project that belongs to another workspace', async () => {
    const svc = svcWith(buildPrisma({ project: { workspaceId: 'other-ws' } }));
    await expect(svc.create(user, baseCreate)).rejects.toThrow(
      /Project does not belong to this workspace/i,
    );
  });

  it('rejects an epic from a different project', async () => {
    const svc = svcWith(buildPrisma({ epic: { projectId: 'p2' } }));
    await expect(svc.create(user, { ...baseCreate, epicId: 'e1' })).rejects.toThrow(
      /Epic belongs to a different project/i,
    );
  });

  it('rejects a parent requirement that does not exist', async () => {
    const svc = svcWith(buildPrisma());
    await expect(svc.create(user, { ...baseCreate, parentRequirementId: 'gone' })).rejects.toThrow(
      /Parent requirement not found/i,
    );
  });

  it('accepts links that live in the same project', async () => {
    const svc = svcWith(
      buildPrisma({ epic: { projectId: 'p1' }, clientRequirement: { projectId: 'p1' } }),
    );
    await expect(
      svc.create(user, { ...baseCreate, epicId: 'e1', clientRequirementId: 'cr1' }),
    ).resolves.toMatchObject({ hierarchyId: 'P-A-B-C-01' });
  });
});

describe('FunctionalRequirementsService.create — hierarchy id allocation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('takes the next free id when the client-supplied one is already used', async () => {
    // Reproduces the reported bug: the client sends count+1, but 01 and 02 still
    // exist because the id it counted on was freed by an earlier delete.
    const svc = svcWith(buildPrisma({ taken: ['P-A-B-C-01', 'P-A-B-C-02'] }));
    await expect(svc.create(user, baseCreate)).resolves.toMatchObject({
      hierarchyId: 'P-A-B-C-03',
    });
  });

  it('bumps a dotted child id and preserves its zero padding', async () => {
    const svc = svcWith(buildPrisma({ taken: ['P-A-B-C-01.09'] }));
    await expect(
      svc.create(user, { ...baseCreate, hierarchyId: 'P-A-B-C-01.09' }),
    ).resolves.toMatchObject({ hierarchyId: 'P-A-B-C-01.10' });
  });

  it('retries on the unique violation when a concurrent create wins the race', async () => {
    // The probe says the id is free, then the insert loses to a create that
    // committed in between — the P2002 must yield the next id, not a 400.
    const svc = svcWith(buildPrisma({ createFailsOnce: true }));
    await expect(svc.create(user, baseCreate)).resolves.toMatchObject({
      hierarchyId: 'P-A-B-C-02',
    });
  });

  it('rethrows an error that is not a hierarchy-id conflict', async () => {
    const prisma = buildPrisma();
    (prisma.functionalRequirement.create as jest.Mock).mockRejectedValue(new Error('db is down'));
    await expect(svcWith(prisma).create(user, baseCreate)).rejects.toThrow(/db is down/);
  });
});

describe('FunctionalRequirementsService.patch — cycle guard', () => {
  beforeEach(() => jest.clearAllMocks());

  const patch = (dto: UpdateFunctionalRequirementDto, prisma: PrismaService) =>
    svcWith(prisma).patch(user, 'fr1', dto);

  it('refuses to make a requirement its own parent', async () => {
    await expect(patch({ parentRequirementId: 'fr1' }, buildPrisma())).rejects.toThrow(
      /cannot be its own parent/i,
    );
  });

  it('refuses a parent that is a descendant of the requirement', async () => {
    const prisma = buildPrisma({ parent: { projectId: 'p1', parentRequirementId: 'fr1' } });
    await expect(patch({ parentRequirementId: 'fr2' }, prisma)).rejects.toThrow(
      /descendant of this requirement/i,
    );
  });

  it('leaves a plain field update untouched', async () => {
    const prisma = buildPrisma();
    await expect(patch({ title: 'Renamed' }, prisma)).resolves.toMatchObject({ title: 'Renamed' });
  });
});

describe('FunctionalRequirementsService.patch — a completed sprint is a record', () => {
  beforeEach(() => jest.clearAllMocks());

  const closed = { projectId: 'p1', status: 'COMPLETED', name: 'Sprint 1' };
  const open = { projectId: 'p1', status: 'ACTIVE', name: 'Sprint 2' };

  it('refuses to plan a requirement into a sprint that has closed', async () => {
    const prisma = buildPrisma({ sprint: closed });
    await expect(svcWith(prisma).patch(user, 'fr1', { sprintId: 's1' })).rejects.toThrow(
      /"Sprint 1" is completed/,
    );
    expect(prisma.functionalRequirement.update).not.toHaveBeenCalled();
  });

  it('refuses to take a requirement out of a sprint that has closed', async () => {
    const prisma = buildPrisma({
      sprint: closed,
      self: { id: 'fr1', workspaceId: 'w1', projectId: 'p1', sprintId: 's1' },
    });
    await expect(svcWith(prisma).patch(user, 'fr1', { sprintId: '' })).rejects.toThrow(
      /cannot be re-planned/,
    );
    expect(prisma.functionalRequirement.update).not.toHaveBeenCalled();
  });

  it('plans a requirement into a sprint that is still open', async () => {
    const prisma = buildPrisma({ sprint: open });
    await expect(svcWith(prisma).patch(user, 'fr1', { sprintId: 's2' })).resolves.toMatchObject({
      sprintId: 's2',
    });
  });

  // Everything else about a requirement in a closed sprint stays editable: the
  // rule is about what the sprint contained, not about freezing the row.
  it('still lets a requirement in a closed sprint be renamed', async () => {
    const prisma = buildPrisma({
      sprint: closed,
      self: { id: 'fr1', workspaceId: 'w1', projectId: 'p1', sprintId: 's1' },
    });
    await expect(
      svcWith(prisma).patch(user, 'fr1', { title: 'Renamed', sprintId: 's1' }),
    ).resolves.toMatchObject({ title: 'Renamed' });
  });
});
