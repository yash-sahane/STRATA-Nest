import type { PrismaService } from '@strata/prisma';
import type { Project, User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ProjectsService } from './projects.service';

const user = { id: 'u1', name: 'Ada' } as User;

/**
 * The stored row every `update` test resolves against. It carries a real,
 * ORDERED date range on purpose: `update` merges the patch onto this row before
 * checking the ordering, so a mock without dates would make both sides
 * `undefined` and the guard would short-circuit — the tests would pass without
 * ever entering the branch they exist to cover.
 */
const existing = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'Mobile Alpha',
  shortCode: 'MOA',
  description: 'as it was',
  status: 'PLANNING',
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  endDate: new Date('2026-08-01T00:00:00.000Z'),
  // The conflict check renders this row with `projectResponse` to compare it against
  // what the editor believed, so the fields that mapper reads have to be here — a
  // half-filled row would make every comparison one between two undefineds.
  createdAt: new Date(0),
  updatedAt: new Date(0),
  version: 7,
} as Project;

function build(
  clash: { id: string } | null,
  conflictCheck: { writes?: number[]; present?: boolean } = {},
) {
  // A list, so a test can make the first conditional write lose a race and the second
  // win it. Default: every attempt lands.
  const writes = [...(conflictCheck.writes ?? [1, 1, 1])];
  const updateMany = jest.fn().mockImplementation(() => {
    const count = writes.shift();
    return Promise.resolve({ count: count === undefined ? 1 : count });
  });
  const present = conflictCheck.present ?? true;
  const create = jest.fn().mockResolvedValue({
    id: 'p2',
    workspaceId: 'w1',
    name: 'Mobile Alpha',
    shortCode: 'MOA',
    description: '',
    clientName: '',
    logo: '',
    color: '',
    methodology: 'SCRUM',
    status: 'PLANNING',
    archived: false,
    startDate: null,
    endDate: null,
    ownerId: 'u1',
    createdById: 'u1',
    createdByName: 'Ada',
    memberIds: [],
    projectSettings: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const update = jest.fn().mockResolvedValue({ ...existing, createdAt: new Date(0), updatedAt: new Date(0) });
  // `activityLog` is mocked even though nothing here asserts on the trail:
  // writeAuditRow swallows every error, so a Prisma mock WITHOUT it lets
  // `prisma.activityLog.create` throw a TypeError on every create/update and
  // the suite still goes green — which quietly means the audit call on those
  // paths is never actually executed by these tests.
  const activityLogCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    project: {
      // findFirst backs BOTH the scope lookup (update path) and the code probe;
      // the probe is the only call that passes a `shortCode` filter.
      findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Object.prototype.hasOwnProperty.call(where, 'shortCode')
          ? Promise.resolve(clash)
          : Promise.resolve(existing),
      ),
      create,
      update,
      // The conditional write. `count` is what decides the outcome, so it is what these
      // tests vary: 1 means it landed, 0 means somebody wrote in the gap and the service
      // should look again rather than declare a conflict.
      updateMany,
      // Re-read after each attempt, both to report the result and to see what the other
      // writer actually did.
      findUnique: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            present ? { ...existing, createdAt: new Date(0), updatedAt: new Date(0) } : null,
          ),
        ),
    },
    activityLog: { create: activityLogCreate },
  } as unknown as PrismaService;
  const access = {
    assertPermission: jest.fn().mockResolvedValue(undefined),
    scopeWhere: jest.fn().mockResolvedValue({}),
  } as unknown as WorkspaceAccessService;
  return { svc: new ProjectsService(prisma, access), create, update, updateMany, activityLogCreate };
}

const dto = { workspaceId: 'w1', name: 'Mobile Alpha', shortCode: 'MOA' };

/** The `data` object the service handed to `prisma.project.update`. */
const writtenData = (update: jest.Mock): Record<string, unknown> =>
  update.mock.calls[0][0].data as Record<string, unknown>;

describe('ProjectsService — shortCode is unique per workspace', () => {
  it('rejects a create whose code is already used in the workspace', async () => {
    const { svc, create } = build({ id: 'p1' });
    await expect(svc.create(user, dto)).rejects.toThrow(
      'Project code "MOA" is already used by another project in this workspace.',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('allows a create whose code is free', async () => {
    const { svc, create } = build(null);
    await expect(svc.create(user, dto)).resolves.toMatchObject({ id: 'p2', shortCode: 'MOA' });
    expect(create).toHaveBeenCalled();
  });

  it('rejects an update that moves a project onto a taken code', async () => {
    const { svc, update } = build({ id: 'p9' });
    await expect(svc.update(user, 'p1', { shortCode: 'ZZZ' })).rejects.toThrow(
      'Project code "ZZZ" is already used by another project in this workspace.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('does not probe when the update leaves the code unchanged', async () => {
    const { svc, update } = build({ id: 'p9' });
    await expect(svc.update(user, 'p1', { shortCode: 'MOA' })).resolves.toMatchObject({ id: 'p1' });
    expect(update).toHaveBeenCalled();
  });

  it('writes one audit row per successful create', async () => {
    const { svc, activityLogCreate } = build(null);
    await svc.create(user, dto);
    expect(activityLogCreate).toHaveBeenCalledTimes(1);
    expect(activityLogCreate.mock.calls[0][0].data).toMatchObject({
      action: 'project.created',
      entityType: 'project',
      entityId: 'p2',
    });
  });
});

describe('ProjectsService — a project cannot end before it starts', () => {
  it('rejects a create whose endDate precedes its startDate', async () => {
    const { svc, create } = build(null);
    await expect(
      svc.create(user, { ...dto, startDate: '2026-06-01', endDate: '2026-01-01' }),
    ).rejects.toThrow('endDate must be on or after startDate');
    expect(create).not.toHaveBeenCalled();
  });

  it('allows a create whose range is ordered, and an equal-day range', async () => {
    const ordered = build(null);
    await expect(
      ordered.svc.create(user, { ...dto, startDate: '2026-06-01', endDate: '2026-08-01' }),
    ).resolves.toBeDefined();
    expect(ordered.create).toHaveBeenCalled();

    const sameDay = build(null);
    await expect(
      sameDay.svc.create(user, { ...dto, startDate: '2026-06-01', endDate: '2026-06-01' }),
    ).resolves.toBeDefined();
    expect(sameDay.create).toHaveBeenCalled();
  });

  it('allows a create with only one end of the range', async () => {
    const { svc, create } = build(null);
    await expect(svc.create(user, { ...dto, endDate: '2026-01-01' })).resolves.toBeDefined();
    expect(create).toHaveBeenCalled();
  });

  // The one-sided patch is the whole reason the check lives on the merged range
  // rather than on the DTO: nothing in this request is self-contradictory, and
  // only the stored startDate makes it invalid.
  it('rejects a patch of endDate alone that lands before the STORED startDate', async () => {
    const { svc, update } = build(null);
    await expect(svc.update(user, 'p1', { endDate: '2026-01-01' })).rejects.toThrow(
      'endDate must be on or after startDate',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a patch of startDate alone that lands after the STORED endDate', async () => {
    const { svc, update } = build(null);
    await expect(svc.update(user, 'p1', { startDate: '2026-12-01' })).rejects.toThrow(
      'endDate must be on or after startDate',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts a patch that inverts nothing because it clears the other end', async () => {
    const { svc, update } = build(null);
    await expect(
      svc.update(user, 'p1', { startDate: null, endDate: '2020-01-01' }),
    ).resolves.toBeDefined();
    expect(writtenData(update)).toMatchObject({ startDate: null });
    expect(writtenData(update).endDate).toEqual(new Date('2020-01-01T00:00:00.000Z'));
  });

  // `null` CLEARS, `undefined` (absent) LEAVES ALONE. Conflating the two is how
  // a cleared date used to come straight back after a "saved successfully".
  it('writes null for a cleared date and touches nothing for an absent one', async () => {
    const cleared = build(null);
    await cleared.svc.update(user, 'p1', { endDate: null });
    expect(writtenData(cleared.update)).toHaveProperty('endDate', null);
    expect(writtenData(cleared.update)).not.toHaveProperty('startDate');

    const untouched = build(null);
    await untouched.svc.update(user, 'p1', { name: 'Renamed' });
    expect(writtenData(untouched.update)).not.toHaveProperty('startDate');
    expect(writtenData(untouched.update)).not.toHaveProperty('endDate');
  });

  it('rejects a date it cannot parse rather than storing Invalid Date', async () => {
    const { svc, create } = build(null);
    await expect(svc.create(user, { ...dto, startDate: 'not-a-date' })).rejects.toThrow(
      'Start date is not a valid date.',
    );
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * Projects own their CRUD instead of inheriting ScopedCrudService, so the lost-update
 * guard is written out a second time in projects.service.ts. Two copies of a rule is
 * exactly how the two drift apart, and the failure would be silent — a project settings
 * page that overwrites without a word while four other screens refuse to. These pin this
 * copy to the same behaviour scoped-crud.locking.spec.ts pins the other to.
 */
describe('ProjectsService — two people editing one project', () => {
  /** What the editor believed, matching the stored row above. */
  const openedWith = { name: 'Mobile Alpha', description: 'as it was' };

  it('writes conditionally on the row it just read', async () => {
    const { svc, updateMany } = build(null);
    await svc.update(user, 'p1', { name: 'Renamed', basedOn: openedWith });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', version: 7 },
      data: { name: 'Renamed', version: { increment: 1 } },
    });
  });

  it('refuses a save to a field somebody else has changed', async () => {
    const { svc, updateMany } = build(null);
    await expect(
      svc.update(user, 'p1', { name: 'Renamed', basedOn: { name: 'what it used to be' } }),
    ).rejects.toThrow(/changed the name/);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('lets a save through when the other change was to a different field', async () => {
    // They edited the description; this edits the name. Nothing clashes, so nobody is
    // sent away to redo work — the case a row-level version counter gets wrong.
    const { svc, updateMany } = build(null);
    await expect(
      svc.update(user, 'p1', {
        name: 'Renamed',
        basedOn: { name: 'Mobile Alpha', description: 'something else entirely' },
      }),
    ).resolves.toMatchObject({ id: 'p1' });
    expect(updateMany).toHaveBeenCalled();
  });

  it('compares dates in the shape the client received them', async () => {
    // The row holds an instant; the response renders `yyyy-MM-dd`. Comparing the two raw
    // would call every date a conflict.
    const { svc } = build(null);
    await expect(
      svc.update(user, 'p1', { name: 'Renamed', basedOn: { startDate: '2026-06-01' } }),
    ).resolves.toMatchObject({ id: 'p1' });
  });

  it('looks again when somebody writes between the read and the write', async () => {
    const { svc, updateMany } = build(null, { writes: [0, 1] });
    await svc.update(user, 'p1', { name: 'Renamed', basedOn: openedWith });
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('says the project was deleted rather than changed when it is gone', async () => {
    const { svc } = build(null, { writes: [0], present: false });
    await expect(
      svc.update(user, 'p1', { name: 'Renamed', basedOn: openedWith }),
    ).rejects.toThrow(/deleted while you were editing/);
  });

  it('bumps the counter even when the caller sent no basedOn', async () => {
    const { svc, update, updateMany } = build(null);
    await svc.update(user, 'p1', { name: 'Renamed' });
    // The counter is what makes the checked path atomic. An unchecked save that did not
    // move it could land between another client's read and its write, unnoticed.
    expect(writtenData(update)).toMatchObject({ version: { increment: 1 } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('records the edited fields in the audit trail, not the counter', async () => {
    const { svc, activityLogCreate } = build(null);
    await svc.update(user, 'p1', { name: 'Renamed' });
    const changed = activityLogCreate.mock.calls[0][0].data.changes.fields as string[];
    // `version` is bookkeeping. Listing it would put "changed version" in front of
    // somebody reading the trail to find out what a colleague actually did.
    expect(changed).toEqual(['name']);
  });
});
