import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { UserDeactivationService } from './user-deactivation.service';

const admin = { id: 'admin', isSuperuser: true } as User;
const target = { id: 'u1', name: 'Asha', email: 'asha@x.com', isActive: true } as User;

/**
 * Switching an account off used to flip its flag and nothing else — or, through
 * this service (which no route called), delete every membership outright. The
 * memberships are now switched OFF, and the owner and last-manager rules every
 * other way out of a workspace keeps hold here too.
 */
function build(
  opts: {
    memberships?: Array<{ id: string; workspaceId: string }>;
    /** Names of the workspaces the person owns. */
    owns?: string[];
    /** Workspaces where this person is the last ACTIVE manager. */
    lastManagerOf?: string[];
  } = {},
) {
  const memberships = opts.memberships ?? [
    { id: 'm1', workspaceId: 'w1' },
    { id: 'm2', workspaceId: 'w2' },
  ];
  const deleted = (rows: Array<{ id: string }> = []) => ({
    findMany: jest.fn().mockResolvedValue(rows),
    deleteMany: jest.fn().mockResolvedValue({ count: rows.length }),
  });
  const tx = {
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue(memberships),
      updateMany: jest.fn().mockResolvedValue({ count: memberships.length }),
    },
    workspace: {
      findMany: jest.fn().mockImplementation((args: { where: { ownerId?: string } }) =>
        Promise.resolve(
          args.where.ownerId !== undefined
            ? (opts.owns ?? []).map((name) => ({ name }))
            : (opts.lastManagerOf ?? []).map((id) => ({ name: `Workspace ${id}` })),
        ),
      ),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
    activeTimer: deleted([{ id: 't1' }]),
    notification: deleted([{ id: 'n1' }]),
    joinRequest: deleted(),
    // HR is preserved: if anything ever reached for it, these would say so.
    attendance: deleted(),
    timeEntry: deleted(),
    // The administration lock of each workspace the account is in.
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(target) },
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const access = {
    isPlatformAdmin: (u: User) => u.isSuperuser === true,
    capabilitiesOrphanedBy: jest.fn(async (workspaceId: string) =>
      (opts.lastManagerOf ?? []).includes(workspaceId) ? [Permission.MemberUpdate] : [],
    ),
  } as unknown as WorkspaceAccessService;
  const tokens = { revokeAll: jest.fn().mockResolvedValue(undefined) };
  const sideEffects = { emitDeletes: jest.fn(), emitUpdates: jest.fn() };
  const svc = new UserDeactivationService(prisma, access, tokens as never, sideEffects as never);
  return { svc, tx, access, tokens, sideEffects };
}

describe('UserDeactivationService — switching an account off', () => {
  it('switches every active membership off instead of deleting it', async () => {
    const { svc, tx, sideEffects } = build();
    await expect(svc.deactivate(admin, 'u1')).resolves.toEqual({ deactivated: true });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isActive: false, status: 'INACTIVE' },
    });
    expect(tx.workspaceMember.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'ACTIVE' },
      select: { id: true, workspaceId: true },
    });
    expect(tx.workspaceMember.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
      data: { status: 'INACTIVE' },
    });
    // updateMany is invisible to the write hook: each roster hears it, in its own workspace.
    expect(sideEffects.emitUpdates).toHaveBeenCalledWith([
      { collection: 'workspace_members', id: 'm1', workspaceId: 'w1' },
      { collection: 'workspace_members', id: 'm2', workspaceId: 'w2' },
    ]);
  });

  it('ends its sessions and drops its timer, and keeps its HR record', async () => {
    const { svc, tx, tokens, sideEffects } = build();
    await svc.deactivate(admin, 'u1');
    expect(tokens.revokeAll).toHaveBeenCalledWith('u1');
    expect(tx.activeTimer.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(sideEffects.emitDeletes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ collection: 'active_timers', id: 't1' })]),
    );
    expect(tx.attendance.deleteMany).not.toHaveBeenCalled();
    expect(tx.timeEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('asks the last-manager question of each workspace, inside the transaction', async () => {
    const { svc, tx, access } = build();
    await svc.deactivate(admin, 'u1');
    expect(access.capabilitiesOrphanedBy).toHaveBeenCalledWith(
      'w1',
      { membershipId: 'm1', role: null },
      tx,
    );
    expect(access.capabilitiesOrphanedBy).toHaveBeenCalledWith(
      'w2',
      { membershipId: 'm2', role: null },
      tx,
    );
  });

  // By identity and with no platform-admin exemption, as leaving holds it: the
  // workspace is handed over first.
  it('refuses the owner of a workspace, platform admin or not, and writes nothing', async () => {
    const { svc, tx, tokens } = build({ owns: ['Acme'] });
    await expect(svc.deactivate(admin, 'u1')).rejects.toThrow(
      'Asha owns "Acme". Hand it to somebody else first',
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.workspaceMember.updateMany).not.toHaveBeenCalled();
    expect(tokens.revokeAll).not.toHaveBeenCalled();
  });

  it('refuses the last manager of a workspace, naming it, and writes nothing', async () => {
    const { svc, tx, tokens } = build({ lastManagerOf: ['w2'] });
    await expect(svc.deactivate(admin, 'u1')).rejects.toThrow(
      'Asha is the last manager of "Workspace w2". Make somebody else a manager there first',
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.workspaceMember.updateMany).not.toHaveBeenCalled();
    expect(tokens.revokeAll).not.toHaveBeenCalled();
  });

  it('still switches off an account that belongs to no workspace', async () => {
    const { svc, tx, sideEffects } = build({ memberships: [] });
    await expect(svc.deactivate(admin, 'u1')).resolves.toEqual({ deactivated: true });
    expect(tx.workspaceMember.updateMany).not.toHaveBeenCalled();
    expect(sideEffects.emitUpdates).toHaveBeenCalledWith([]);
  });

  // A manager demoted in one of these workspaces at the same moment would
  // otherwise pass its own check while this one counted that manager.
  it('holds each workspace’s administration still, in id order, before asking', async () => {
    const { svc, tx, access } = build({
      memberships: [
        { id: 'm2', workspaceId: 'w2' },
        { id: 'm1', workspaceId: 'w1' },
      ],
    });
    await svc.deactivate(admin, 'u1');
    const locks = tx.$executeRaw.mock.calls.map((call: unknown[]) => call.slice(1).join(','));
    expect(locks).toEqual(['administration:w1', 'administration:w2']);
    const lastLock = Math.max(...tx.$executeRaw.mock.invocationCallOrder);
    const firstCheck = Math.min(
      ...(access.capabilitiesOrphanedBy as jest.Mock).mock.invocationCallOrder,
    );
    expect(lastLock).toBeLessThan(firstCheck);
  });
});
