import { EventEmitter2 } from '@nestjs/event-emitter';
import { refreshClientRequirementRollup, type PrismaService } from '@strata/prisma';
import type { Epic, User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { EpicsService } from './epics.service';

jest.mock('@strata/prisma', () => ({
  ...jest.requireActual('@strata/prisma'),
  refreshClientRequirementRollup: jest.fn().mockResolvedValue(true),
}));
const refreshClient = refreshClientRequirementRollup as jest.Mock;

const user = { id: 'u1', name: 'U' } as User;

const stored = {
  id: 'e1',
  workspaceId: 'w1',
  projectId: 'p1',
  requirementId: 'cr-old',
  hierarchyId: 'P-CR-EPI-01',
  name: 'Checkout',
  description: '',
  color: '',
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  endDate: new Date('2026-09-01T00:00:00.000Z'),
  status: 'TODO',
  progress: 0,
  version: 1,
  createdById: 'u1',
  createdByName: 'U',
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
} as unknown as Epic;

function build(
  opts: {
    /** The functional requirements under the epic that are not yet under the target. */
    requirements?: Array<{ id: string; clientRequirementId: string }>;
    /** The status of the project the epic is in. */
    projectStatus?: string;
  } = {},
) {
  const requirements = opts.requirements ?? [];
  const tx = {
    functionalRequirement: {
      findMany: jest.fn().mockResolvedValue(requirements),
      updateMany: jest.fn().mockResolvedValue({ count: requirements.length }),
    },
  };
  const prisma = {
    epic: {
      findFirst: jest.fn().mockResolvedValue(stored),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...stored, ...data, version: 2 }),
      ),
    },
    // The target client requirement is in the epic's project.
    clientRequirement: { findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }) },
    // The epic's project takes changes (see project-archive).
    project: { findUnique: jest.fn().mockResolvedValue({ status: opts.projectStatus ?? 'ACTIVE' }) },
    functionalRequirement: {
      // The moved rows, re-read for the announcement after the commit.
      findMany: jest.fn().mockResolvedValue(requirements.map((r) => ({ ...r, epicId: 'e1' }))),
    },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    announceWrite: jest.fn(),
  };
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  const svc = new EpicsService(prisma as unknown as PrismaService, access, new EventEmitter2());
  return { svc, prisma, tx };
}

beforeEach(() => refreshClient.mockClear());

describe('EpicsService.patch — moving an epic to another client requirement', () => {
  it('takes the requirements under it along, and refreshes every client requirement they touch', async () => {
    const { svc, prisma, tx } = build({
      requirements: [
        { id: 'fr1', clientRequirementId: 'cr-old' },
        // Filed somewhere else by hand; it is under this epic, so it follows too.
        { id: 'fr2', clientRequirementId: 'cr-stray' },
      ],
    });

    await svc.patch(user, 'e1', { requirementId: 'cr-new' });

    expect(prisma.epic.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requirementId: 'cr-new' }) }),
    );
    // Only the epic's own requirements, in its own project, that are not there yet.
    expect(tx.functionalRequirement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { epicId: 'e1', projectId: 'p1', clientRequirementId: { not: 'cr-new' } },
      }),
    );
    expect(tx.functionalRequirement.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['fr1', 'fr2'] } },
      data: { clientRequirementId: 'cr-new', version: { increment: 1 } },
    });
    // On the transaction's client: the statuses commit with the move.
    const refreshed = refreshClient.mock.calls.map(([client, id]) => {
      expect(client).toBe(tx);
      return id;
    });
    expect(refreshed.sort()).toEqual(['cr-new', 'cr-old', 'cr-stray']);
    // updateMany is invisible to the realtime hook: the moved rows are announced.
    expect(prisma.announceWrite).toHaveBeenCalledTimes(2);
    expect(prisma.announceWrite).toHaveBeenCalledWith(
      'FunctionalRequirement',
      'update',
      expect.objectContaining({ id: 'fr1' }),
    );
  });

  it('takes them out of every client requirement when the epic is detached', async () => {
    const { svc, tx } = build({ requirements: [{ id: 'fr1', clientRequirementId: 'cr-old' }] });

    await svc.patch(user, 'e1', { requirementId: '' });

    expect(tx.functionalRequirement.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['fr1'] } },
      data: { clientRequirementId: '', version: { increment: 1 } },
    });
    expect(refreshClient.mock.calls.map(([, id]) => id)).toEqual(['cr-old']);
  });

  it('touches no requirement when the client requirement does not change', async () => {
    const { svc, prisma } = build({ requirements: [{ id: 'fr1', clientRequirementId: 'cr-old' }] });

    await svc.patch(user, 'e1', { requirementId: 'cr-old', name: 'Checkout v2' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(refreshClient).not.toHaveBeenCalled();
  });

  it('touches no requirement for an edit that does not name a client requirement', async () => {
    const { svc, prisma } = build();

    await svc.patch(user, 'e1', { name: 'Checkout v2' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// The stored epic runs 2026-06-01 → 2026-09-01.
describe('EpicsService.patch — dates', () => {
  it('reads a cleared start date as cleared, not as the date being removed', async () => {
    const { svc, prisma } = build();

    // Ending before the OLD start is fine once there is no start at all.
    await expect(
      svc.patch(user, 'e1', { startDate: '', endDate: '2026-05-01' }),
    ).resolves.toBeDefined();
    expect(prisma.epic.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ startDate: null }) }),
    );
  });

  it('still refuses an end-only edit that lands before the stored start', async () => {
    const { svc, prisma } = build();

    await expect(svc.patch(user, 'e1', { endDate: '2026-05-01' })).rejects.toThrow(
      'Target end date must be on or after the start date.',
    );
    expect(prisma.epic.update).not.toHaveBeenCalled();
  });
});
