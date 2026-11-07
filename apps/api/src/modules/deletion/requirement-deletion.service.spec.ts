import { refreshDeliveryRollups, type PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { RequirementDeletionService } from './requirement-deletion.service';

jest.mock('@strata/prisma', () => ({
  ...jest.requireActual('@strata/prisma'),
  refreshDeliveryRollups: jest.fn().mockResolvedValue(undefined),
}));
const refresh = refreshDeliveryRollups as jest.Mock;

const user = { id: 'u1' } as User;
const access = () =>
  ({ assertPermission: jest.fn().mockResolvedValue(undefined), isPlatformAdmin: () => true }) as never;
const sideEffects = () => ({ emitDeletes: jest.fn(), emitUpdates: jest.fn() }) as never;

/** tx double: every delegate finds nothing and changes nothing unless a case says otherwise. */
const tx = () =>
  new Proxy(
    {},
    {
      get: () => ({
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      }),
    },
  );

const node = (id: string, hierarchyId: string, epicId: string, clientRequirementId: string) => ({
  id,
  workspaceId: 'w1',
  projectId: 'p1',
  hierarchyId,
  epicId,
  clientRequirementId,
});

/** `findMany` answers the walk level by level: the given levels in order, then nothing. */
function prismaWith(levels: unknown[][], extra: Record<string, unknown> = {}) {
  const findMany = jest.fn();
  for (const level of levels) findMany.mockResolvedValueOnce(level);
  findMany.mockResolvedValue([]);
  return {
    functionalRequirement: { findMany, ...((extra.functionalRequirement as object) ?? {}) },
    clientRequirement: extra.clientRequirement ?? { findUnique: jest.fn() },
    // Its project takes changes (see project-archive).
    project: extra.project ?? { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: (cb: (t: unknown) => unknown) => cb(tx()),
  } as unknown as PrismaService;
}

beforeEach(() => refresh.mockClear());

describe('RequirementDeletionService — the roll-ups a cascade leaves behind', () => {
  it("refreshes the epic and client requirement of EVERY requirement a client requirement's cascade deletes", async () => {
    const prisma = prismaWith(
      [
        // The requirements raised from cr1 …
        [node('fr1', 'P-A-01', 'e1', 'cr1'), node('fr2', 'P-B-02', 'e2', 'cr1')],
        // … and a child of fr1 filed under another epic and client requirement.
        [node('fr3', 'P-A-01.01', 'e3', 'cr9')],
      ],
      {
        clientRequirement: {
          findUnique: jest.fn().mockResolvedValue({ id: 'cr1', workspaceId: 'w1' }),
        },
      },
    );
    const svc = new RequirementDeletionService(prisma, access(), sideEffects());

    await svc.deleteClientRequirement(user, 'cr1', true);

    expect(refresh).toHaveBeenCalledTimes(1);
    const [, parents] = refresh.mock.calls[0];
    expect([...parents.epicIds].sort()).toEqual(['e1', 'e2', 'e3']);
    // The deleted client requirement itself has nothing left to refresh.
    expect([...parents.clientRequirementIds]).toEqual(['cr9']);
  });

  it('refreshes nothing when the client requirement held no requirements', async () => {
    const prisma = prismaWith([[]], {
      clientRequirement: { findUnique: jest.fn().mockResolvedValue({ id: 'cr1', workspaceId: 'w1' }) },
    });
    const svc = new RequirementDeletionService(prisma, access(), sideEffects());

    await svc.deleteClientRequirement(user, 'cr1', false);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes every deleted descendant's epic and client requirement, not only the root's", async () => {
    const root = { ...node('fr1', 'P-A-01', 'e1', 'cr1'), title: 'Checkout' };
    const prisma = prismaWith([[node('fr2', 'P-A-01.01', 'e2', 'cr2')]], {
      functionalRequirement: { findUnique: jest.fn().mockResolvedValue(root) },
    });
    const svc = new RequirementDeletionService(prisma, access(), sideEffects());

    await svc.deleteFunctionalRequirement(user, 'fr1', true);

    const [, parents] = refresh.mock.calls[0];
    expect([...parents.epicIds].sort()).toEqual(['e1', 'e2']);
    expect([...parents.clientRequirementIds].sort()).toEqual(['cr1', 'cr2']);
  });
});
