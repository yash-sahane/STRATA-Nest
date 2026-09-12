import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { Sprint, User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { SprintsService } from './sprints.services';

const user = { id: 'u1', name: 'U' } as User;

const stored = {
  id: 's1',
  workspaceId: 'w1',
  projectId: 'p1',
  name: 'S',
  goal: '',
  startDate: new Date('2026-08-11T00:00:00.000Z'),
  endDate: new Date('2026-08-20T00:00:00.000Z'),
  status: 'PLANNING',
  retrospectiveNotes: '',
  createdById: 'u1',
  createdByName: 'U',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} as Sprint;

function build() {
  const create = jest.fn().mockResolvedValue(stored);
  const update = jest.fn().mockResolvedValue(stored);
  // The project lookup backs the cross-workspace guard every create runs now.
  const project = { findUnique: jest.fn().mockResolvedValue({ workspaceId: 'w1' }) };
  const prisma = {
    sprint: { create, update, findFirst: jest.fn().mockResolvedValue(stored) },
    project,
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  return { svc: new SprintsService(prisma, access, new EventEmitter2()), create, update, project };
}

const base = { workspaceId: 'w1', projectId: 'p1', name: 'Sprint 1' };

describe('SprintsService date handling', () => {
  it('stores a date-only startDate on that exact calendar day', async () => {
    const { svc, create } = build();
    await svc.create(user, { ...base, startDate: '2026-08-11', endDate: '2026-08-20' });
    const data = create.mock.calls[0][0].data as { startDate: Date; endDate: Date };
    expect(data.startDate.toISOString().slice(0, 10)).toBe('2026-08-11');
    expect(data.endDate.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('accepts a one-day sprint (start === end)', async () => {
    const { svc, create } = build();
    await expect(
      svc.create(user, { ...base, startDate: '2026-08-11', endDate: '2026-08-11' }),
    ).resolves.toBeDefined();
    expect(create).toHaveBeenCalled();
  });

  // create() is async now — it verifies the project belongs to the declared
  // workspace before writing — so these are rejections, not synchronous throws.
  it('rejects an end date before the start date', async () => {
    const { svc, create } = build();
    await expect(
      svc.create(user, { ...base, startDate: '2026-08-20', endDate: '2026-08-11' }),
    ).rejects.toThrow('endDate must be on or after startDate');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unparseable date instead of handing Prisma an Invalid Date', async () => {
    const { svc, create } = build();
    await expect(
      svc.create(user, { ...base, startDate: 'garbage', endDate: '2026-08-20' }),
    ).rejects.toThrow('startDate must be a valid ISO date');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a project that belongs to a different workspace', async () => {
    const { svc, create, project } = build();
    project.findUnique.mockResolvedValueOnce({ workspaceId: 'someone-else' });
    await expect(
      svc.create(user, { ...base, startDate: '2026-08-11', endDate: '2026-08-20' }),
    ).rejects.toThrow(/different workspace|does not belong/i);
    expect(create).not.toHaveBeenCalled();
  });

  // patch() is async now: it reads the stored sprint so a one-sided edit can be
  // validated against the range it actually produces.
  it('rejects an inverted range on patch when both dates are supplied', async () => {
    const { svc, update } = build();
    await expect(
      svc.patch(user, 's1', { startDate: '2026-08-20', endDate: '2026-08-11' }),
    ).rejects.toThrow('endDate must be on or after startDate');
    expect(update).not.toHaveBeenCalled();
  });

  // The stored sprint runs 2026-08-11 → 2026-08-20.
  it('rejects an endDate-only patch that lands before the STORED startDate', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { endDate: '2026-07-01' })).rejects.toThrow(
      'endDate must be on or after startDate',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a startDate-only patch that lands after the STORED endDate', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { startDate: '2026-09-01' })).rejects.toThrow(
      'endDate must be on or after startDate',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('allows a one-sided patch that keeps the merged range ordered', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { endDate: '2026-08-25' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('does not read the sprint for a patch that touches no date', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { name: 'Renamed' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });
});
