import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { InvitationAcceptanceService, JoinRequestApprovalService } from './workflows.services';

const invitee = { id: 'u1', email: 'invitee@example.com' } as User;

function buildCode(
  overrides: { invite?: Record<string, unknown>; membership?: unknown; claimed?: number } = {},
) {
  const invite = {
    id: 'c1',
    workspaceId: 'w1',
    code: 'JOINME',
    role: 'MANAGER',
    maxUses: 3,
    usedCount: 0,
    expiresAt: null,
    ...overrides.invite,
  };
  // The seat claim is a CONDITIONAL updateMany inside an interactive
  // transaction, so the limit is re-tested by the write itself rather than by
  // the read above it. `claimed` says how many rows the condition matched: 0
  // means another caller took the last seat first.
  const codeUpdate = jest
    .fn()
    .mockResolvedValue({ count: (overrides.claimed as number | undefined) ?? 1 });
  const create = jest.fn().mockResolvedValue({ id: 'm-new' });
  const closeRequests = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    inviteCode: { updateMany: codeUpdate },
    workspaceMember: { create },
    joinRequest: { updateMany: closeRequests },
  };
  const prisma = {
    inviteCode: { findUnique: jest.fn().mockResolvedValue(invite) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(overrides.membership ?? null), create },
    joinRequest: { updateMany: closeRequests },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  } as unknown as PrismaService;
  const access = { assertValidRole: jest.fn().mockResolvedValue(undefined) } as unknown as WorkspaceAccessService;
  const svc = new InvitationAcceptanceService(prisma, access, new EventEmitter2());
  return { svc, prisma, codeUpdate, create, closeRequests };
}

describe('InvitationAcceptanceService — invite codes are only consumed when they grant something', () => {
  it('increments usedCount and creates the membership for a new member', async () => {
    const { svc, codeUpdate, create } = buildCode();
    await expect(svc.accept(invitee, { code: 'JOINME' })).resolves.toMatchObject({
      success: true,
      workspaceId: 'w1',
      role: 'MANAGER',
    });
    expect(codeUpdate).toHaveBeenCalledWith({
      where: { id: 'c1', usedCount: { lt: 3 } },
      data: { usedCount: { increment: 1 } },
    });
    expect(create).toHaveBeenCalled();
  });

  it('refuses the join when another caller took the last seat first', async () => {
    // The conditional update matching no rows IS the race being lost: two people
    // redeeming a single-use code together used to both succeed, leaving
    // usedCount above maxUses.
    const { svc, create } = buildCode({ invite: { maxUses: 1 }, claimed: 0 });
    await expect(svc.accept(invitee, { code: 'JOINME' })).rejects.toThrow(/exhausted/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not burn a use when the caller is already a member', async () => {
    // The old code incremented unconditionally, so one member re-submitting a
    // code they had already redeemed could exhaust maxUses for everyone else.
    const { svc, prisma, codeUpdate, create } = buildCode({
      membership: { id: 'm1', workspaceId: 'w1', userId: 'u1', role: 'MEMBER', status: 'ACTIVE' },
    });
    await expect(svc.accept(invitee, { code: 'JOINME' })).resolves.toMatchObject({
      success: true,
      membershipId: 'm1',
      role: 'MEMBER', // the membership's real role, not the code's
    });
    expect(codeUpdate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('settles a pending join request inside the seat-claim transaction', async () => {
    const { svc, closeRequests } = buildCode();
    await svc.accept(invitee, { code: 'JOINME' });
    expect(closeRequests).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u1', status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
  });

  // "Already a member" used to cover a membership that had been switched off,
  // so the screen announced access the person did not have.
  it('tells a switched-off member the truth instead of reporting success', async () => {
    const { svc, codeUpdate, create } = buildCode({
      membership: { id: 'm1', workspaceId: 'w1', userId: 'u1', role: 'MEMBER', status: 'INACTIVE' },
    });
    await expect(svc.accept(invitee, { code: 'JOINME' })).rejects.toThrow(
      'Your access to this workspace is switched off.',
    );
    expect(codeUpdate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to grant a role the workspace can no longer resolve', async () => {
    const { svc, prisma, create } = buildCode();
    const access = (svc as unknown as { access: WorkspaceAccessService }).access;
    (access.assertValidRole as jest.Mock).mockRejectedValue(
      new BadRequestException('Unknown role "MANAGER" for this workspace.'),
    );
    await expect(svc.accept(invitee, { code: 'JOINME' })).rejects.toThrow('Unknown role');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('asks for a code when none is given', async () => {
    const { svc } = buildCode();
    await expect(svc.accept(invitee, { code: '' })).rejects.toThrow('Provide an invite code');
  });

  it('rejects an exhausted or expired code before touching anything', async () => {
    const exhausted = buildCode({ invite: { maxUses: 2, usedCount: 2 } });
    await expect(exhausted.svc.accept(invitee, { code: 'JOINME' })).rejects.toThrow(
      'Invite code exhausted',
    );
    const expired = buildCode({ invite: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(expired.svc.accept(invitee, { code: 'JOINME' })).rejects.toThrow(
      'Invite code expired',
    );
  });
});

describe('JoinRequestApprovalService — approving lets the requester in, at a chosen role', () => {
  const approver = { id: 'mgr' } as User;

  function buildApproval(
    opts: {
      membership?: Record<string, unknown> | null;
      outranked?: boolean;
      status?: string;
      /** The switched-off member outranks the approver. */
      memberOutranks?: boolean;
      /** Somebody else decided the request between our read and our write. */
      decidedMeanwhile?: boolean;
      /** Who owns the workspace (the requester is u9). */
      ownerId?: string;
      platformAdmin?: boolean;
    } = {},
  ) {
    const request = { id: 'j1', workspaceId: 'w1', userId: 'u9', status: opts.status ?? 'PENDING' };
    // The decision is a CONDITIONAL write on the request still being PENDING;
    // `count: 0` is losing the race to another approver.
    const claim = jest.fn().mockResolvedValue({ count: opts.decidedMeanwhile ? 0 : 1 });
    const create = jest.fn().mockResolvedValue({ id: 'm-new' });
    const memberUpdate = jest.fn().mockResolvedValue({ id: 'm1' });
    const tx = {
      joinRequest: { updateMany: claim },
      workspaceMember: { create, update: memberUpdate },
    };
    const announceWrite = jest.fn();
    const prisma = {
      joinRequest: { findUnique: jest.fn().mockResolvedValue(request), updateMany: claim },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue(opts.membership ?? null),
        create,
        update: memberUpdate,
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => Promise.resolve().then(() => fn(tx))),
      announceWrite,
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: opts.ownerId ?? 'someone-else' }),
      },
    } as unknown as PrismaService;
    const access = {
      isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      assertValidRole: jest.fn().mockResolvedValue(undefined),
      assertCanGrantRole: jest.fn().mockImplementation(() =>
        opts.outranked ? Promise.reject(new Error('rank')) : Promise.resolve(),
      ),
      assertNotOutranked: jest.fn().mockImplementation(() =>
        opts.memberOutranks ? Promise.reject(new Error('outranked')) : Promise.resolve(),
      ),
    } as unknown as WorkspaceAccessService;
    const events = new EventEmitter2();
    const emitted: string[] = [];
    events.onAny((name) => emitted.push(String(name)));
    return {
      svc: new JoinRequestApprovalService(prisma, access, events),
      prisma,
      access,
      claim,
      announceWrite,
      create,
      memberUpdate,
      emitted,
    };
  }

  it('creates the membership at the role the approver picked', async () => {
    const { svc, access, create } = buildApproval();
    await expect(svc.approve(approver, 'j1', 'SOFTWARE_DEVELOPER')).resolves.toMatchObject({
      success: true,
      role: 'SOFTWARE_DEVELOPER',
    });
    expect(access.assertCanGrantRole).toHaveBeenCalledWith(approver, 'w1', 'SOFTWARE_DEVELOPER');
    expect(create.mock.calls[0][0].data).toMatchObject({
      workspaceId: 'w1',
      userId: 'u9',
      role: 'SOFTWARE_DEVELOPER',
      status: 'ACTIVE',
    });
  });

  it('defaults to MEMBER when no role is given', async () => {
    const { svc, create } = buildApproval();
    await svc.approve(approver, 'j1');
    expect(create.mock.calls[0][0].data.role).toBe('MEMBER');
  });

  it('refuses a role above the approver’s own, and writes nothing', async () => {
    const { svc, prisma } = buildApproval({ outranked: true });
    await expect(svc.approve(approver, 'j1', 'MANAGER')).rejects.toThrow('rank');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('switches a deactivated member back on instead of approving them into nothing', async () => {
    const { svc, create, memberUpdate, emitted } = buildApproval({
      membership: { id: 'm1', role: 'MEMBER', status: 'INACTIVE' },
    });
    await svc.approve(approver, 'j1', 'TESTER');
    expect(create).not.toHaveBeenCalled();
    expect(memberUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { role: 'TESTER', status: 'ACTIVE' },
    });
    expect(emitted).toContain('workspace.member.added');
  });

  // Switching somebody back on is the member screen's decision, under its rules.
  it('switching a member back on takes member:update and the rank rule', async () => {
    const { svc, access } = buildApproval({
      membership: { id: 'm1', role: 'MANAGER', status: 'INACTIVE' },
    });
    await svc.approve(approver, 'j1', 'TESTER');
    expect(access.assertPermission).toHaveBeenCalledWith(approver, 'w1', 'member:update');
    expect(access.assertNotOutranked).toHaveBeenCalledWith(approver, 'w1', 'MANAGER');
  });

  it('and refuses when the switched-off member outranks the approver', async () => {
    const { svc, memberUpdate } = buildApproval({
      membership: { id: 'm1', role: 'MANAGER', status: 'INACTIVE' },
      memberOutranks: true,
    });
    await expect(svc.approve(approver, 'j1', 'TESTER')).rejects.toThrow('outranked');
    expect(memberUpdate).not.toHaveBeenCalled();
  });

  it('only clears the request when they are already an active member', async () => {
    const { svc, create, memberUpdate, emitted } = buildApproval({
      membership: { id: 'm1', role: 'MANAGER', status: 'ACTIVE' },
    });
    await expect(svc.approve(approver, 'j1', 'MEMBER')).resolves.toMatchObject({ role: 'MANAGER' });
    expect(create).not.toHaveBeenCalled();
    expect(memberUpdate).not.toHaveBeenCalled();
    expect(emitted).toEqual(['workspace.join_request.approved']);
  });

  it('refuses a request that has already been decided', async () => {
    const { svc } = buildApproval({ status: 'REJECTED' });
    await expect(svc.approve(approver, 'j1')).rejects.toThrow(
      'This join request has already been decided.',
    );
  });

  // Approving a returning member with the default role demoted a manager who
  // had been switched off to the read-only floor, silently.
  it('brings a switched-off member back at the role they held when none is named', async () => {
    const { svc, access, memberUpdate } = buildApproval({
      membership: { id: 'm1', role: 'SOFTWARE_DEVELOPER', status: 'INACTIVE' },
    });
    await expect(svc.approve(approver, 'j1')).resolves.toMatchObject({ role: 'SOFTWARE_DEVELOPER' });
    // Under the same rank rule as any other grant of that role.
    expect(access.assertCanGrantRole).toHaveBeenCalledWith(approver, 'w1', 'SOFTWARE_DEVELOPER');
    expect(memberUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { role: 'SOFTWARE_DEVELOPER', status: 'ACTIVE' },
    });
  });

  // The member screen refuses anybody but a platform admin a change to the
  // owner's role; bringing a switched-off owner back at another role is one.
  it('brings a switched-off OWNER back only at the role they held, unless a platform admin', async () => {
    const owner = { membership: { id: 'm1', role: 'MANAGER', status: 'INACTIVE' }, ownerId: 'u9' };
    const other = buildApproval(owner);
    await expect(other.svc.approve(approver, 'j1', 'TESTER')).rejects.toThrow(
      'The workspace owner’s role can only be changed by a platform administrator.',
    );
    expect(other.memberUpdate).not.toHaveBeenCalled();

    const same = buildApproval(owner);
    await expect(same.svc.approve(approver, 'j1')).resolves.toMatchObject({ role: 'MANAGER' });

    const admin = buildApproval({ ...owner, platformAdmin: true });
    await expect(admin.svc.approve(approver, 'j1', 'TESTER')).resolves.toMatchObject({ role: 'TESTER' });
  });

  it('decides the request only if it is still pending, and announces it', async () => {
    const { svc, claim, announceWrite } = buildApproval();
    await svc.approve(approver, 'j1', 'TESTER');
    expect(claim).toHaveBeenCalledWith({
      where: { id: 'j1', status: 'PENDING' },
      data: { status: 'APPROVED', handledById: 'mgr' },
    });
    // A conditional updateMany is invisible to the write hook.
    expect(announceWrite).toHaveBeenCalledWith('JoinRequest', 'update', expect.objectContaining({ id: 'j1' }));
  });

  // Two managers at once: the second used to get "A record with these values
  // already exists" (approve twice) or leave a REJECTED request beside an
  // ACTIVE member with both notices sent (approve + decline).
  it('tells the second approver it was already decided, and grants nothing', async () => {
    const { svc, create, memberUpdate, emitted } = buildApproval({ decidedMeanwhile: true });
    await expect(svc.approve(approver, 'j1', 'TESTER')).rejects.toThrow(
      'This join request has already been decided.',
    );
    expect(create).not.toHaveBeenCalled();
    expect(memberUpdate).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('and so a decline that loses the race declines nothing', async () => {
    const { svc, claim, emitted } = buildApproval({ decidedMeanwhile: true });
    await expect(svc.reject(approver, 'j1')).rejects.toThrow(
      'This join request has already been decided.',
    );
    expect(claim).toHaveBeenCalledWith({
      where: { id: 'j1', status: 'PENDING' },
      data: { status: 'REJECTED', handledById: 'mgr' },
    });
    expect(emitted).toEqual([]);
  });

  it('a decline that wins is recorded and told', async () => {
    const { svc, emitted, announceWrite } = buildApproval();
    await expect(svc.reject(approver, 'j1')).resolves.toEqual({ success: true });
    expect(announceWrite).toHaveBeenCalledWith('JoinRequest', 'update', expect.objectContaining({ id: 'j1' }));
    expect(emitted).toEqual(['workspace.join_request.rejected']);
  });
});
