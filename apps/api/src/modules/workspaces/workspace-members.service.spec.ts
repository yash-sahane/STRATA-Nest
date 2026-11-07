import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User, WorkspaceMember } from '@prisma/client';
import { capabilitiesOrphaned, type AdministrationChange } from '../authz/administration';
import { Permission, permissionsForRole } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { WorkspaceMembersService } from './workspace-members.service';

const caller = { id: 'u1' } as User;

function member(over: Partial<WorkspaceMember> = {}): WorkspaceMember {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'm1',
    workspaceId: 'w1',
    userId: 'u2',
    role: 'MEMBER',
    status: 'ACTIVE',
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as WorkspaceMember;
}

/**
 * The workspace's other ACTIVE memberships, as the shared invariant reads them:
 * `otherManagers` MANAGERs unless `others` names their roles. The member being
 * changed counts too, while their own membership is ACTIVE.
 */
function invariantFor(opts: {
  existing: { id: string; role: string; status: string };
  otherManagers?: number;
  others?: string[];
  customRoles?: Record<string, string[]>;
}) {
  const others =
    opts.others ?? Array.from({ length: opts.otherManagers ?? 1 }, () => 'MANAGER');
  const members = [
    ...(opts.existing.status === 'ACTIVE' ? [{ id: opts.existing.id, role: opts.existing.role }] : []),
    ...others.map((role, i) => ({ id: `m-other-${i}`, role })),
  ];
  const definitions = new Map(Object.entries(opts.customRoles ?? {}));
  // The real invariant over that state: what WorkspaceAccessService loads it from
  // is covered in workspace-access.service.spec.ts.
  return jest
    .fn()
    .mockImplementation(async (_ws: string, change: AdministrationChange) =>
      capabilitiesOrphaned({ members, definitions }, change),
    );
}

function build(opts: {
  existing: WorkspaceMember;
  ownerId?: string;
  /** Other ACTIVE members, all MANAGERs. */
  otherManagers?: number;
  /** Other ACTIVE members by role, when they are not all MANAGERs. */
  others?: string[];
  platformAdmin?: boolean;
  /** Custom WorkspaceRole rows of this workspace: name -> permission strings. */
  customRoles?: Record<string, string[]>;
  /** The rank rule refuses: the caller's role holds less than the one involved. */
  outranked?: boolean;
  /** The member's running timer — one per person, recorded with its workspace. */
  timer?: { id: string; workspaceId: string } | null;
  /** The person being added has a PENDING request to join this workspace. */
  askedToJoin?: boolean;
  /** Rows a conditional update / delete of an invitation matches (1 unless it raced). */
  matched?: number;
}) {
  const update = jest.fn().mockImplementation(({ data }) => ({ ...opts.existing, ...data }));
  const remove = jest.fn().mockResolvedValue(undefined);
  const updateMany = jest.fn().mockResolvedValue({ count: opts.matched ?? 1 });
  const deleteMany = jest.fn().mockResolvedValue({ count: opts.matched ?? 1 });
  const customRoles = opts.customRoles ?? {};
  // Adding or re-activating a membership settles any request that person had
  // raised to join, in the same commit where the write is transactional.
  const closeRequests = jest.fn().mockResolvedValue({ count: 1 });
  const create = jest.fn().mockReturnValue(member({ id: 'm-new', userId: 'u9' }));
  const timerDelete = jest.fn().mockResolvedValue({ count: 1 });
  const announceWrite = jest.fn();
  // The administration lock (pg_advisory_xact_lock), taken inside a transaction.
  const executeRaw = jest.fn().mockResolvedValue(1);
  const prisma: Record<string, unknown> = {
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(opts.existing),
      findMany: jest.fn().mockResolvedValue([opts.existing]),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...opts.existing, status: 'ACTIVE', joinedAt: new Date() }),
      create,
      update,
      updateMany,
      delete: remove,
      deleteMany,
    },
    joinRequest: {
      updateMany: closeRequests,
      count: jest.fn().mockResolvedValue(opts.askedToJoin ? 1 : 0),
    },
    // Array form: the service reads the membership out of position 0. Callback
    // form: the transaction client is this same mock, so a write made through
    // it is the one the cases below look for.
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.resolve(arg),
    ),
    $executeRaw: executeRaw,
    workspaceRole: {
      findMany: jest
        .fn()
        .mockResolvedValue(Object.keys(customRoles).map((name) => ({ name }))),
    },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ ownerId: opts.ownerId ?? 'owner' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'w1', name: 'Acme Web' }]),
    },
    activityLog: {
      findMany: jest.fn().mockResolvedValue([{ workspaceId: 'w1', userId: 'u-inviter' }]),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'u-inviter', name: 'Priya Manager', email: 'priya@x.test' }]),
    },
    // What a removal tidies: none, unless a case says otherwise.
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    task: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    functionalRequirement: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    activeTimer: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.timer ? { ...opts.timer, userId: opts.existing.userId } : null),
      deleteMany: timerDelete,
    },
    announceWrite,
  };
  const capabilitiesOrphanedBy = invariantFor({ ...opts, customRoles });
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    assertValidRole: jest.fn().mockResolvedValue(undefined),
    // The rule itself is covered against the real service in
    // workspace-access.service.spec.ts; here it only has to be CONSULTED.
    assertCanGrantRole: jest.fn().mockImplementation(() =>
      opts.outranked ? Promise.reject(new Error('rank')) : Promise.resolve(),
    ),
    assertNotOutranked: jest.fn().mockImplementation(() =>
      opts.outranked ? Promise.reject(new Error('rank')) : Promise.resolve(),
    ),
    isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
    // Built-in roles resolve without touching the DB, so the real map is the
    // honest stand-in here; custom roles resolve from their stored JSON exactly
    // as WorkspaceAccessService.permissionsOfRole does.
    permissionsOfRole: jest
      .fn()
      .mockImplementation(async (_ws: string, role: string) =>
        permissionsForRole(role, customRoles[role]),
      ),
    capabilitiesOrphanedBy,
  } as unknown as WorkspaceAccessService;
  const events = { emit: jest.fn() } as unknown as EventEmitter2;
  return {
    svc: new WorkspaceMembersService(prisma as unknown as PrismaService, access, events),
    prisma: prisma as unknown as PrismaService,
    update,
    updateMany,
    remove,
    deleteMany,
    access,
    capabilitiesOrphanedBy,
    create,
    closeRequests,
    timerDelete,
    announceWrite,
    executeRaw,
    events,
  };
}

/** The key of every administration lock a case took, in order. */
const locksTaken = (executeRaw: jest.Mock) =>
  executeRaw.mock.calls.map((call) => call.slice(1).join(','));

/** The domain events a case emitted, by name. */
const emitted = (events: EventEmitter2) =>
  (events.emit as jest.Mock).mock.calls.map(([name, e]) => ({ name, payload: e.payload }));

describe('WorkspaceMembersService.create — somebody else’s add is an invitation', () => {
  it('an add the person never asked for is INVITED, and tells them so', async () => {
    const { svc, create, closeRequests, events } = build({ existing: member() });
    await svc.create(caller, { workspaceId: 'w1', userId: 'u9' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'INVITED' }) }),
    );
    // Nothing to answer: they have not asked for anything.
    expect(closeRequests).not.toHaveBeenCalled();
    expect(emitted(events)).toEqual([
      expect.objectContaining({
        name: 'workspace.member.invited',
        payload: expect.objectContaining({ userId: 'u9', actorId: 'u1' }),
      }),
    ]);
  });

  it('asking for ACTIVE or INACTIVE changes nothing: both are one step from access', async () => {
    for (const status of ['ACTIVE', 'INACTIVE']) {
      const { svc, create } = build({ existing: member() });
      await svc.create(caller, { workspaceId: 'w1', userId: 'u9', status });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'INVITED' }) }),
      );
    }
  });

  it('an add that answers their own request to join takes effect, and closes it in the same commit', async () => {
    const { svc, create, closeRequests, events } = build({ existing: member(), askedToJoin: true });
    await svc.create(caller, { workspaceId: 'w1', userId: 'u9' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(closeRequests).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u9', status: 'PENDING' },
      data: { status: 'APPROVED', handledById: caller.id },
    });
    expect(emitted(events)[0].name).toBe('workspace.member.added');
  });

  it("a platform administrator's add takes effect at once", async () => {
    const { svc, create } = build({ existing: member(), platformAdmin: true });
    await svc.create(caller, { workspaceId: 'w1', userId: 'u9' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });
});

describe('WorkspaceMembersService — the invited person answers', () => {
  it('lists their own invitations, with the workspace and who sent it', async () => {
    const { svc, prisma } = build({ existing: member({ status: 'INVITED', userId: 'u1' }) });
    const list = await svc.invitations(caller);
    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'INVITED' } }),
    );
    expect(list).toEqual([
      expect.objectContaining({
        id: 'm1',
        workspaceName: 'Acme Web',
        role: 'MEMBER',
        invitedByName: 'Priya Manager',
      }),
    ]);
  });

  it('accepting is theirs alone: the row is looked up by id AND the caller', async () => {
    const { svc, prisma } = build({ existing: member({ status: 'INVITED', userId: 'u1' }) });
    await svc.accept(caller, 'm1');
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({ where: { id: 'm1', userId: 'u1' } });
  });

  it('accepting makes it ACTIVE from now — only while it is still an invitation — and lets them in', async () => {
    const { svc, updateMany, closeRequests, announceWrite, events } = build({
      existing: member({ status: 'INVITED', userId: 'u1' }),
    });
    await svc.accept(caller, 'm1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', userId: 'u1', status: 'INVITED' },
      data: { status: 'ACTIVE', joinedAt: expect.any(Date) },
    });
    expect(closeRequests).toHaveBeenCalled();
    expect(announceWrite).toHaveBeenCalledWith('WorkspaceMember', 'update', expect.anything());
    expect(emitted(events)).toEqual([
      expect.objectContaining({
        name: 'workspace.member.added',
        payload: expect.objectContaining({ via: 'accepted', actorId: 'u1' }),
      }),
    ]);
  });

  it('an invitation withdrawn as they accept is not resurrected', async () => {
    const { svc, events } = build({ existing: member({ status: 'INVITED', userId: 'u1' }), matched: 0 });
    await expect(svc.accept(caller, 'm1')).rejects.toThrow(/withdrawn/);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('a switched-off membership is not an invitation to accept', async () => {
    const { svc, updateMany } = build({ existing: member({ status: 'INACTIVE', userId: 'u1' }) });
    await expect(svc.accept(caller, 'm1')).rejects.toThrow(/switched off/);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('declining deletes it — only while it is still an invitation — and tells nobody', async () => {
    const { svc, deleteMany, events } = build({ existing: member({ status: 'INVITED', userId: 'u1' }) });
    await svc.decline(caller, 'm1');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', userId: 'u1', status: 'INVITED' } });
    expect(emitted(events)).toEqual([
      expect.objectContaining({
        name: 'workspace.member.removed',
        payload: expect.objectContaining({ via: 'declined' }),
      }),
    ]);
  });
});

describe('WorkspaceMembersService.remove — withdrawing an invitation', () => {
  it('asks member:invite and the rank rule, not the removal guards', async () => {
    const { svc, access, deleteMany, capabilitiesOrphanedBy, events } = build({
      existing: member({ status: 'INVITED' }),
    });
    await svc.remove(caller, 'm1');
    expect(access.assertPermission).toHaveBeenCalledWith(caller, 'w1', Permission.MemberInvite);
    expect(access.assertNotOutranked).toHaveBeenCalled();
    expect(capabilitiesOrphanedBy).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', status: 'INVITED' } });
    expect(emitted(events)[0].payload).toEqual(expect.objectContaining({ via: 'withdrawn' }));
  });

  it('says so when they accepted in the same moment', async () => {
    const { svc } = build({ existing: member({ status: 'INVITED' }), matched: 0 });
    await expect(svc.remove(caller, 'm1')).rejects.toThrow(/accepted the invitation a moment ago/);
  });
});

describe('WorkspaceMembersService — rank', () => {
  it('asks whether the caller may grant the role before adding a member at it', async () => {
    const { svc, access, create } = build({ existing: member(), outranked: true });
    await expect(
      svc.create(caller, { workspaceId: 'w1', userId: 'u9', role: 'MANAGER' }),
    ).rejects.toThrow('rank');
    expect(access.assertCanGrantRole).toHaveBeenCalledWith(caller, 'w1', 'MANAGER');
    expect(create).not.toHaveBeenCalled();
  });

  it('checks both the role handed over and the member it is taken from on a role change', async () => {
    const { svc, access } = build({ existing: member({ role: 'TESTER' }) });
    await svc.update(caller, 'm1', { role: 'MANAGER' });
    expect(access.assertNotOutranked).toHaveBeenCalledWith(caller, 'w1', 'TESTER');
    expect(access.assertCanGrantRole).toHaveBeenCalledWith(caller, 'w1', 'MANAGER');
  });

  it('refuses a promotion the caller is outranked by, without writing', async () => {
    const { svc, update } = build({ existing: member(), outranked: true });
    await expect(svc.update(caller, 'm1', { role: 'MANAGER' })).rejects.toThrow('rank');
    expect(update).not.toHaveBeenCalled();
  });

  it('treats a reactivation as handing the role back', async () => {
    const { svc, access } = build({ existing: member({ role: 'MANAGER', status: 'INACTIVE' }) });
    await svc.update(caller, 'm1', { status: 'ACTIVE' });
    expect(access.assertNotOutranked).toHaveBeenCalledWith(caller, 'w1', 'MANAGER');
  });

  it('refuses to remove a member who outranks the caller', async () => {
    const { svc, remove } = build({ existing: member({ role: 'MANAGER' }), outranked: true });
    await expect(svc.remove(caller, 'm1')).rejects.toThrow('rank');
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('WorkspaceMembersService.update — orphaned-workspace guards', () => {
  it('rejects deactivating your own membership (self-removal by another door)', async () => {
    const { svc, update } = build({ existing: member({ userId: caller.id }) });
    await expect(svc.update(caller, 'm1', { status: 'INACTIVE' })).rejects.toThrow(
      'You cannot change your own role or status.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects changing your own role (self-demotion and self-promotion)', async () => {
    const { svc, update } = build({ existing: member({ userId: caller.id, role: 'MANAGER' }) });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'You cannot change your own role or status.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects demoting or deactivating the workspace owner', async () => {
    const { svc } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
    await expect(svc.update(caller, 'm1', { status: 'INACTIVE' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
  });

  it('rejects demoting the last active manager', async () => {
    const { svc } = build({ existing: member({ role: 'MANAGER' }), otherManagers: 0 });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The last manager of a workspace cannot be demoted.',
    );
  });

  it('allows demoting a manager while another active manager remains', async () => {
    const { svc, update } = build({ existing: member({ role: 'MANAGER' }), otherManagers: 1 });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'MEMBER' } });
  });

  it('leaves a no-op write (same role, re-activation) ungated', async () => {
    const { svc, update } = build({
      existing: member({ userId: caller.id, status: 'INACTIVE' }),
      otherManagers: 0,
    });
    await expect(svc.update(caller, 'm1', { status: 'ACTIVE' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('settles a pending join request when a membership is re-activated', async () => {
    // An INACTIVE membership is not an `activeMembership`, so its holder CAN
    // raise a join request; turning them back on answers it.
    const { svc, closeRequests } = build({
      existing: member({ userId: 'u2', status: 'INACTIVE' }),
    });
    await svc.update(caller, 'm1', { status: 'ACTIVE' });
    expect(closeRequests).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u2', status: 'PENDING' },
      data: { status: 'APPROVED', handledById: caller.id },
    });
  });

  it('does not touch join requests on a write that grants no access', async () => {
    const { svc, closeRequests } = build({ existing: member({ role: 'MANAGER' }) });
    await svc.update(caller, 'm1', { role: 'MEMBER' });
    expect(closeRequests).not.toHaveBeenCalled();
  });

  it('rejects a status outside the three the app models', async () => {
    const { svc } = build({ existing: member() });
    await expect(svc.update(caller, 'm1', { status: 'suspended' })).rejects.toThrow(
      'Unknown membership status "suspended".',
    );
  });

  it('validates the role name against the workspace before writing it', async () => {
    const { svc, access } = build({ existing: member() });
    await svc.update(caller, 'm1', { role: 'MANAGER' });
    expect(access.assertValidRole).toHaveBeenCalledWith('w1', 'MANAGER');
  });

  it('lets a platform admin PROMOTE the owner: the orphan guards are for privilege LOSS', async () => {
    // The workspace's own owner sits on a non-manager role (a legacy label the
    // normalize migration mapped to MEMBER), so the workspace has no manager at
    // all. Repairing it must not be read as "demoting the owner" — and nothing
    // the workspace never had can be "lost" by it.
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MEMBER' }),
      ownerId: 'owner',
      otherManagers: 0,
      platformAdmin: true,
    });
    await expect(svc.update(caller, 'm1', { role: 'MANAGER' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'MANAGER' } });
  });

  // The two-step takeover: a manager who is not the owner mints "Boss" with
  // everything, moves the owner onto it (nothing lost, so no guard fired), then
  // cuts Boss down on the roles screen. The move itself is now refused.
  it('refuses a SIDEWAYS move of the owner onto a custom role by anybody but a platform admin', async () => {
    const all = Object.values(Permission) as string[];
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
      customRoles: { Boss: all },
    });
    await expect(svc.update(caller, 'm1', { role: 'Boss' })).rejects.toThrow(
      'The workspace owner’s role can only be changed by a platform administrator.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a promotion of the owner by anybody but a platform admin', async () => {
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'ASSISTANT_MANAGER' }),
      ownerId: 'owner',
    });
    await expect(svc.update(caller, 'm1', { role: 'MANAGER' })).rejects.toThrow(
      'The workspace owner’s role can only be changed by a platform administrator.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('still lets a manager move anybody else sideways', async () => {
    const all = Object.values(Permission) as string[];
    const { svc, update } = build({
      existing: member({ role: 'MANAGER' }),
      customRoles: { Boss: all },
    });
    await expect(svc.update(caller, 'm1', { role: 'Boss' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'Boss' } });
  });

  it('lets a platform admin repair a workspace whose last manager is the owner', async () => {
    // MEMBER, not ASSISTANT_MANAGER: the demotion has to actually cost the
    // workspace both capabilities, or the exemption is never exercised.
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
      otherManagers: 0,
      platformAdmin: true,
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('refuses MANAGER -> ASSISTANT_MANAGER on the owner: it strips workspace:delete', async () => {
    // ASSISTANT_MANAGER is `ALL` minus workspace:delete, so it KEEPS member:update.
    // Treating member:update as the only admin capability let this demotion skip
    // the owner guard entirely and leave the workspace with nobody able to delete it.
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
    });
    await expect(svc.update(caller, 'm1', { role: 'ASSISTANT_MANAGER' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a custom role that keeps member:update but drops workspace:delete', async () => {
    // The attacker mints `Ghost` with exactly the permission the old guard keyed
    // on, then patches the owner onto it. Capability is resolved from the stored
    // JSON, so the disguise does not work.
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
      customRoles: { Ghost: ['member:update'] },
    });
    await expect(svc.update(caller, 'm1', { role: 'Ghost' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('protects the last admin of a workspace administered through a CUSTOM role', async () => {
    // No membership anywhere carries the literal string 'MANAGER', so the old
    // `role: 'MANAGER'` count query never ran and this workspace had no
    // last-admin protection at all.
    const { svc } = build({
      existing: member({ role: 'Owner' }),
      customRoles: { Owner: ['member:update', 'workspace:delete'] },
      otherManagers: 0,
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The last manager of a workspace cannot be demoted.',
    );
  });

  it('counts capability holders by role, not by the literal name MANAGER', async () => {
    // Demoting the last MANAGER is fine when somebody on a custom role still
    // resolves to the same capabilities…
    const steward = build({
      existing: member({ role: 'MANAGER' }),
      customRoles: { Steward: ['member:update', 'workspace:delete'] },
      others: ['Steward'],
    });
    await expect(steward.svc.update(caller, 'm1', { role: 'MEMBER' })).resolves.toBeDefined();
    expect(steward.update).toHaveBeenCalled();
    // …and asked of the membership as the write will leave it.
    expect(steward.capabilitiesOrphanedBy).toHaveBeenCalledWith(
      'w1',
      { membershipId: 'm1', role: 'MEMBER' },
      expect.anything(),
    );

    // …and refused when the only other member's role merely has a grand name.
    const tester = build({ existing: member({ role: 'MANAGER' }), others: ['TESTER'] });
    await expect(tester.svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The last manager of a workspace cannot be demoted.',
    );
  });

  it('still refuses a SELF-promotion, which the privilege-loss test alone would miss', async () => {
    const { svc, update } = build({ existing: member({ userId: caller.id, role: 'MEMBER' }) });
    await expect(svc.update(caller, 'm1', { role: 'MANAGER' })).rejects.toThrow(
      'You cannot change your own role or status.',
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('WorkspaceMembersService.update — INVITED is not reversible', () => {
  /**
   * Applying "Invited" to somebody who had already joined revoked their access
   * outright: an INVITED row is not an activeMembership, so every scoped read
   * answered 404 or zero rows — while the save reported success and the
   * directory showed a friendly yellow "Invited" badge. Nothing said they were
   * locked out.
   */
  it('refuses to put a member who has joined back to INVITED', async () => {
    const { svc, update } = build({ existing: member({ status: 'ACTIVE' }), otherManagers: 2 });
    await expect(svc.update(caller, 'm1', { status: 'INVITED' })).rejects.toThrow(
      /already joined/i,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('names INACTIVE as the way to revoke access', async () => {
    const { svc } = build({ existing: member({ status: 'ACTIVE' }), otherManagers: 2 });
    await expect(svc.update(caller, 'm1', { status: 'INVITED' })).rejects.toThrow(/Inactive/i);
  });

  it('and INACTIVE really is accepted', async () => {
    const { svc, update } = build({ existing: member({ status: 'ACTIVE' }), otherManagers: 2 });
    await svc.update(caller, 'm1', { status: 'INACTIVE' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'INACTIVE' } }));
  });

  it('leaves an INVITED membership editable — it has not joined yet', async () => {
    // Re-saving the same status on a pending invitation is a no-op, not a lockout.
    const { svc, update } = build({ existing: member({ status: 'INVITED' }), otherManagers: 2 });
    await svc.update(caller, 'm1', { status: 'INVITED' });
    expect(update).toHaveBeenCalled();
  });

  it('a manager cannot answer an invitation for the person — in either direction', async () => {
    for (const status of ['ACTIVE', 'INACTIVE']) {
      const { svc, update } = build({ existing: member({ status: 'INVITED' }), otherManagers: 2 });
      await expect(svc.update(caller, 'm1', { status })).rejects.toThrow(/only they can/);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('but can still correct the role it offers', async () => {
    const { svc, update } = build({ existing: member({ status: 'INVITED' }), otherManagers: 2 });
    await svc.update(caller, 'm1', { role: 'TESTER' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'TESTER' } }));
  });

  it('a platform administrator can let an invitation in: they join from now, and are told they were added', async () => {
    const { svc, update, events } = build({
      existing: member({ status: 'INVITED' }),
      otherManagers: 2,
      platformAdmin: true,
    });
    await svc.update(caller, 'm1', { status: 'ACTIVE' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE', joinedAt: expect.any(Date) } }),
    );
    // Not "access switched back on": they never had it.
    expect(emitted(events).map((e) => e.name)).toEqual(['workspace.member.added']);
  });
});

describe('WorkspaceMembersService.remove — unchanged invariants', () => {
  it('still refuses the owner, the caller and the last manager', async () => {
    const owner = build({ existing: member({ userId: 'owner' }), ownerId: 'owner' });
    await expect(owner.svc.remove(caller, 'm1')).rejects.toThrow(
      'The workspace owner cannot be removed.',
    );

    const self = build({ existing: member({ userId: caller.id }) });
    await expect(self.svc.remove(caller, 'm1')).rejects.toThrow(
      'You cannot remove your own membership.',
    );

    const last = build({ existing: member({ role: 'MANAGER' }), otherManagers: 0 });
    await expect(last.svc.remove(caller, 'm1')).rejects.toThrow(
      'The last manager of a workspace cannot be removed.',
    );
  });

  it('removes an ordinary member', async () => {
    const { svc, remove } = build({ existing: member() });
    await expect(svc.remove(caller, 'm1')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  // An INACTIVE manager authorizes nothing, so taking them off the roster
  // cannot orphan anything — even where no other manager is active.
  it('does not count a switched-off manager as the last one', async () => {
    const { svc, remove } = build({
      existing: member({ role: 'MANAGER', status: 'INACTIVE' }),
      otherManagers: 0,
    });
    await expect(svc.remove(caller, 'm1')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalled();
  });
});

/**
 * A timer is filed into the workspace it was started for, which asks for
 * hr:write there. Somebody removed or switched off could never stop it again,
 * and holding one timer at a time, could not start one anywhere else either.
 */
describe('WorkspaceMembersService — a membership that ends takes its running timer with it', () => {
  it('drops the timer on removal when it runs for this workspace, and says so', async () => {
    const { svc, timerDelete, announceWrite } = build({
      existing: member(),
      timer: { id: 't1', workspaceId: 'w1' },
    });
    await svc.remove(caller, 'm1');
    expect(timerDelete).toHaveBeenCalledWith({ where: { id: 't1', workspaceId: 'w1' } });
    // deleteMany is invisible to the write hook: their own screen has to hear it.
    expect(announceWrite).toHaveBeenCalledWith(
      'ActiveTimer',
      'delete',
      expect.objectContaining({ id: 't1' }),
    );
  });

  it('drops it when their access is switched off', async () => {
    const { svc, timerDelete } = build({
      existing: member(),
      timer: { id: 't1', workspaceId: 'w1' },
    });
    await svc.update(caller, 'm1', { status: 'INACTIVE' });
    expect(timerDelete).toHaveBeenCalledWith({ where: { id: 't1', workspaceId: 'w1' } });
  });

  it('leaves a timer running for ANOTHER workspace alone', async () => {
    const { svc, timerDelete } = build({
      existing: member(),
      timer: { id: 't1', workspaceId: 'w2' },
    });
    await svc.remove(caller, 'm1');
    await svc.update(caller, 'm1', { status: 'INACTIVE' });
    expect(timerDelete).not.toHaveBeenCalled();
  });

  it('touches no timer on a change that keeps them in', async () => {
    const { svc, timerDelete } = build({
      existing: member({ role: 'MANAGER' }),
      timer: { id: 't1', workspaceId: 'w1' },
    });
    await svc.update(caller, 'm1', { role: 'TESTER' });
    expect(timerDelete).not.toHaveBeenCalled();
  });
});

describe('WorkspaceMembersService.remove — they come off open requirements too', () => {
  it('drops them from an open requirement’s assignees and its names, in step', async () => {
    const { svc, prisma } = build({ existing: member({ userId: 'u2' }) });
    const db = prisma as unknown as {
      functionalRequirement: { findMany: jest.Mock; update: jest.Mock };
    };
    db.functionalRequirement.findMany.mockResolvedValue([
      { id: 'fr1', assigneeIds: ['u3', 'u2'], assigneeNames: ['Three', 'Two'] },
    ]);
    await svc.remove(caller, 'm1');
    // Signed-off (DEPLOYED) requirements keep the record of who delivered them.
    expect(db.functionalRequirement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'w1',
          status: { not: 'DEPLOYED' },
          assigneeIds: { array_contains: ['u2'] },
        },
      }),
    );
    expect(db.functionalRequirement.update).toHaveBeenCalledWith({
      where: { id: 'fr1' },
      data: { assigneeIds: ['u3'], assigneeNames: ['Three'], version: { increment: 1 } },
    });
  });

  it('keeps the names when they do not line up with the ids, rather than drop the wrong one', async () => {
    const { svc, prisma } = build({ existing: member({ userId: 'u2' }) });
    const db = prisma as unknown as {
      functionalRequirement: { findMany: jest.Mock; update: jest.Mock };
    };
    db.functionalRequirement.findMany.mockResolvedValue([
      { id: 'fr1', assigneeIds: ['u3', 'u2'], assigneeNames: ['Three'] },
    ]);
    await svc.remove(caller, 'm1');
    expect(db.functionalRequirement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeIds: ['u3'], assigneeNames: ['Three'] }),
      }),
    );
  });
});

describe('WorkspaceMembersService.leave — a member ends their own membership', () => {
  const me = { id: 'u-me' } as User;

  function buildLeave(opts: {
    membership?: Record<string, unknown> | null;
    ownerId?: string;
    otherAdmins?: number;
    platformAdmin?: boolean;
  }) {
    const membership =
      opts.membership === null
        ? null
        : { id: 'm-me', workspaceId: 'w1', userId: 'u-me', role: 'MEMBER', status: 'ACTIVE', ...opts.membership };
    const remove = jest.fn().mockResolvedValue({});
    const prisma = {
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue(membership),
        delete: remove,
      },
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: opts.ownerId ?? 'u-owner' }) },
      workspaceRole: { findMany: jest.fn().mockResolvedValue([]) },
      // Leaving tidies as a removal does: none to tidy unless a case says so.
      leaveRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      task: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      functionalRequirement: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      activeTimer: { findUnique: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    } as Record<string, unknown>;
    // Leaving is checked and written under the administration lock, on the
    // transaction client — this same mock.
    prisma.$transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    const access = {
      isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
      // The built-in matrix, as the real service resolves it.
      permissionsOfRole: jest.fn().mockImplementation(async (_ws: string, role: string) =>
        permissionsForRole(role),
      ),
      capabilitiesOrphanedBy: membership
        ? invariantFor({
            existing: membership as { id: string; role: string; status: string },
            otherManagers: opts.otherAdmins ?? 0,
          })
        : jest.fn(),
      assertPermission: jest.fn().mockRejectedValue(new Error('must not be asked')),
    } as unknown as WorkspaceAccessService;
    const emit = jest.fn();
    const svc = new WorkspaceMembersService(
      prisma as unknown as PrismaService,
      access,
      { emit } as unknown as EventEmitter2,
    );
    return { svc, remove, emit, access, prisma };
  }

  // As a removal does: the boards stop naming somebody who has gone, and an
  // approver is not left deciding leave for a person who is no longer here.
  it('withdraws their pending leave and takes them off open tasks', async () => {
    const { svc, prisma } = buildLeave({});
    const db = prisma as unknown as {
      leaveRequest: { findMany: jest.Mock; updateMany: jest.Mock };
      task: { findMany: jest.Mock; update: jest.Mock };
    };
    db.leaveRequest.findMany.mockResolvedValueOnce([{ id: 'lr1' }]).mockResolvedValue([]);
    db.task.findMany.mockResolvedValue([
      { id: 't1', assigneeIds: ['u-me', 'u-2'], assigneeNames: ['Me', 'Two'] },
    ]);
    await svc.leave(me, 'w1');
    expect(db.leaveRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['lr1'] }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(db.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ assigneeIds: ['u-2'], assigneeNames: ['Two'] }),
      }),
    );
  });

  it('lets an ordinary member leave, with no permission asked for', async () => {
    const { svc, remove, emit, access } = buildLeave({});
    await svc.leave(me, 'w1');
    expect(remove).toHaveBeenCalledWith({ where: { id: 'm-me' } });
    expect(access.assertPermission).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'workspace.member.removed',
      expect.objectContaining({
        payload: expect.objectContaining({ userId: 'u-me', via: 'left' }),
      }),
    );
  });

  it('answers 404 to somebody who is not a member', async () => {
    const { svc, remove } = buildLeave({ membership: null });
    await expect(svc.leave(me, 'w1')).rejects.toThrow('Not found.');
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses the owner, platform admin or not', async () => {
    for (const platformAdmin of [false, true]) {
      const { svc, remove } = buildLeave({
        ownerId: 'u-me',
        membership: { role: 'MANAGER' },
        otherAdmins: 3,
        platformAdmin,
      });
      await expect(svc.leave(me, 'w1')).rejects.toThrow('You own this workspace');
      expect(remove).not.toHaveBeenCalled();
    }
  });

  it('refuses the last manager, and says what to do about it', async () => {
    const { svc, remove } = buildLeave({ membership: { role: 'MANAGER' }, otherAdmins: 0 });
    await expect(svc.leave(me, 'w1')).rejects.toThrow(
      'You are the last manager of this workspace. Make somebody else a manager before you leave.',
    );
    expect(remove).not.toHaveBeenCalled();
  });

  // A switched-off membership is a manager's decision on record. Deleting it
  // by "leaving" let the same person redeem an invite code and be active again.
  it('refuses a member whose access has been switched off', async () => {
    const { svc, remove } = buildLeave({ membership: { status: 'INACTIVE' } });
    await expect(svc.leave(me, 'w1')).rejects.toThrow('Your access to this workspace is switched off.');
    expect(remove).not.toHaveBeenCalled();
  });

  it('lets a manager leave when another one remains', async () => {
    const { svc, remove } = buildLeave({ membership: { role: 'MANAGER' }, otherAdmins: 1 });
    await svc.leave(me, 'w1');
    expect(remove).toHaveBeenCalled();
  });

  it('asks the last-manager question under the administration lock, on the transaction', async () => {
    const { svc, access, prisma } = buildLeave({ membership: { role: 'MANAGER' }, otherAdmins: 1 });
    await svc.leave(me, 'w1');
    const executeRaw = (prisma as { $executeRaw: jest.Mock }).$executeRaw;
    expect(locksTaken(executeRaw)).toEqual(['administration:w1']);
    expect(access.capabilitiesOrphanedBy).toHaveBeenCalledWith(
      'w1',
      { membershipId: 'm-me', role: null },
      prisma,
    );
  });
});

/**
 * The last-manager rule is only as good as the state it reads. Each demotion,
 * switch-off, removal and departure is checked and written as one unit, under a
 * per-workspace lock, or two of them in flight at once each read the other's
 * target as still in charge.
 */
describe('WorkspaceMembersService — the last-manager check and its write are one unit', () => {
  it('a demotion takes the lock before the check, and checks and writes on the transaction', async () => {
    const { svc, prisma, update, executeRaw, capabilitiesOrphanedBy } = build({
      existing: member({ role: 'MANAGER' }),
      otherManagers: 1,
    });
    await svc.update(caller, 'm1', { role: 'MEMBER' });
    expect(locksTaken(executeRaw)).toEqual(['administration:w1']);
    expect(capabilitiesOrphanedBy).toHaveBeenCalledWith(
      'w1',
      { membershipId: 'm1', role: 'MEMBER' },
      prisma,
    );
    const [lock] = executeRaw.mock.invocationCallOrder;
    const [check] = capabilitiesOrphanedBy.mock.invocationCallOrder;
    const [write] = update.mock.invocationCallOrder;
    expect(lock).toBeLessThan(check);
    expect(check).toBeLessThan(write);
  });

  it('a switch-off is held to the same unit', async () => {
    const { svc, executeRaw, capabilitiesOrphanedBy } = build({
      existing: member({ role: 'MANAGER' }),
      otherManagers: 1,
    });
    await svc.update(caller, 'm1', { status: 'INACTIVE' });
    expect(locksTaken(executeRaw)).toEqual(['administration:w1']);
    expect(capabilitiesOrphanedBy).toHaveBeenCalledWith(
      'w1',
      { membershipId: 'm1', role: null },
      expect.anything(),
    );
  });

  it('a removal is too', async () => {
    const { svc, prisma, remove, executeRaw, capabilitiesOrphanedBy } = build({
      existing: member({ role: 'MANAGER' }),
      otherManagers: 1,
    });
    await svc.remove(caller, 'm1');
    expect(locksTaken(executeRaw)).toEqual(['administration:w1']);
    expect(capabilitiesOrphanedBy).toHaveBeenCalledWith(
      'w1',
      { membershipId: 'm1', role: null },
      prisma,
    );
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      remove.mock.invocationCallOrder[0],
    );
  });

  it('a promotion or a sideways move cannot orphan anything, and takes no lock', async () => {
    const { svc, update, executeRaw } = build({ existing: member({ role: 'MEMBER' }) });
    await svc.update(caller, 'm1', { role: 'MANAGER' });
    expect(update).toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('nothing is written when the check refuses', async () => {
    const { svc, update, executeRaw } = build({
      existing: member({ role: 'MANAGER' }),
      otherManagers: 0,
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The last manager of a workspace cannot be demoted.',
    );
    expect(executeRaw).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * The race itself, against a stand-in for Postgres: the lock is held until the
   * transaction that took it ends, and the invariant reads whatever has been
   * written by then. The only two managers demote each other at the same moment.
   */
  it('of two managers demoting each other at once, exactly one succeeds', async () => {
    const rows = [
      member({ id: 'm-a', userId: 'u-a', role: 'MANAGER' }),
      member({ id: 'm-b', userId: 'u-b', role: 'MANAGER' }),
    ];
    let lockChain: Promise<void> = Promise.resolve();
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const workspaceMember = {
      findFirst: jest.fn(async ({ where }: { where: { AND: Array<{ id?: string }> } }) => {
        const id = where.AND.find((c) => c.id)?.id;
        const row = rows.find((r) => r.id === id);
        return row ? ({ ...row } as unknown as WorkspaceMember) : null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        await tick();
        const row = rows.find((r) => r.id === where.id) as Record<string, unknown>;
        Object.assign(row, data);
        return { ...row };
      }),
    };
    const prisma = {
      workspaceMember,
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'u-owner' }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      activeTimer: { findUnique: jest.fn().mockResolvedValue(null) },
      // Each transaction may take the lock; it is released when the transaction ends.
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let release: (() => void) | undefined;
        const tx = {
          workspaceMember,
          $executeRaw: jest.fn(async () => {
            const held = lockChain;
            lockChain = new Promise<void>((resolve) => (release = resolve));
            await held;
            return 1;
          }),
        };
        try {
          return await fn(tx);
        } finally {
          release?.();
        }
      }),
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({}),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      assertValidRole: jest.fn().mockResolvedValue(undefined),
      assertCanGrantRole: jest.fn().mockResolvedValue(undefined),
      assertNotOutranked: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      permissionsOfRole: jest.fn(async (_ws: string, role: string) => permissionsForRole(role)),
      // The real invariant over the rows as they stand when it is asked — after
      // a pause, so that, unserialised, both checks would read the same state.
      capabilitiesOrphanedBy: jest.fn(async (_ws: string, change: AdministrationChange) => {
        await tick();
        const members = rows.filter((r) => r.status === 'ACTIVE').map(({ id, role }) => ({ id, role }));
        return capabilitiesOrphaned({ members, definitions: new Map() }, change);
      }),
    } as unknown as WorkspaceAccessService;
    const svc = new WorkspaceMembersService(prisma, access, {
      emit: jest.fn(),
    } as unknown as EventEmitter2);

    const results = await Promise.allSettled([
      svc.update({ id: 'u-a' } as User, 'm-b', { role: 'MEMBER' }),
      svc.update({ id: 'u-b' } as User, 'm-a', { role: 'MEMBER' }),
    ]);
    // Which one wins depends on who reaches the lock first; that one wins.
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? 'saved' : String(r.reason)));
    expect(outcomes.sort()).toEqual([
      'ForbiddenException: The last manager of a workspace cannot be demoted.',
      'saved',
    ]);
    // The workspace keeps exactly one manager.
    expect(rows.filter((r) => r.role === 'MANAGER')).toHaveLength(1);
  });
});
