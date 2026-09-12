import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { InvitationAcceptanceService } from './workflows.services';

const invitee = { id: 'u1', email: 'invitee@example.com' } as User;

function build(
  overrides: {
    invitation?: Record<string, unknown>;
    membership?: unknown;
    roleValid?: boolean;
  } = {},
) {
  const invitation = {
    id: 'i1',
    workspaceId: 'w1',
    email: 'invitee@example.com',
    role: 'MANAGER',
    token: 'tok',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides.invitation,
  };
  const update = jest.fn().mockReturnValue({ op: 'update' });
  const create = jest.fn().mockReturnValue({ op: 'create' });
  const closeRequests = jest.fn().mockReturnValue({ op: 'close-join-requests' });
  const prisma = {
    emailInvitation: { findUnique: jest.fn().mockResolvedValue(invitation), update },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(overrides.membership ?? null), create },
    joinRequest: { updateMany: closeRequests },
    $transaction: jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
  const assertValidRole = jest.fn().mockImplementation(async (_ws: string, role: string) => {
    if (overrides.roleValid === false) {
      throw new BadRequestException(`Unknown role "${role}" for this workspace.`);
    }
  });
  const access = { assertValidRole } as unknown as WorkspaceAccessService;
  const svc = new InvitationAcceptanceService(prisma, access, new EventEmitter2());
  return { svc, prisma, update, create, closeRequests, assertValidRole };
}

describe('InvitationAcceptanceService — e-mail invitations are bound to the invited address', () => {
  it('refuses a token presented by a different account', async () => {
    const { svc, create } = build();
    await expect(
      svc.accept({ ...invitee, email: 'outsider@example.com' } as User, { token: 'tok' }),
    ).rejects.toThrow('This invitation was issued for a different e-mail address');
    expect(create).not.toHaveBeenCalled();
  });

  it('matches the address case-insensitively (invitations are stored lower-cased)', async () => {
    const { svc, create } = build();
    await expect(
      svc.accept({ ...invitee, email: 'Invitee@Example.com' } as User, { token: 'tok' }),
    ).resolves.toMatchObject({ success: true, workspaceId: 'w1', role: 'MANAGER' });
    expect(create).toHaveBeenCalled();
  });

  it('marks the invitation accepted and creates the membership at the invited role', async () => {
    const { svc, update, create } = build();
    await svc.accept(invitee, { token: 'tok' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { status: 'ACCEPTED' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: 'w1', userId: 'u1', role: 'MANAGER', status: 'ACTIVE' }),
      }),
    );
  });

  it('does not burn the invitation when the caller is already a member', async () => {
    const { svc, prisma, update, create } = build({
      membership: { id: 'm1', workspaceId: 'w1', userId: 'u1', role: 'MEMBER' },
    });
    await expect(svc.accept(invitee, { token: 'tok' })).resolves.toMatchObject({
      success: true,
      membershipId: 'm1',
      role: 'MEMBER',
    });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('settles a pending join request in the SAME commit as the membership', async () => {
    // The requester can have asked to join and then been sent an invitation.
    // Leaving the request PENDING left the manager an approve/decline decision
    // about somebody who was already an ACTIVE member.
    const { svc, prisma, closeRequests } = build();
    await svc.accept(invitee, { token: 'tok' });
    expect(closeRequests).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u1', status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      { op: 'update' },
      { op: 'create' },
      { op: 'close-join-requests' },
    ]);
  });

  it('settles a stale request even when the caller was already a member', async () => {
    const { svc, closeRequests } = build({
      membership: { id: 'm1', workspaceId: 'w1', userId: 'u1', role: 'MEMBER' },
    });
    await svc.accept(invitee, { token: 'tok' });
    expect(closeRequests).toHaveBeenCalled();
  });

  it('refuses to grant a role the workspace can no longer resolve', async () => {
    const { svc, create, assertValidRole } = build({ roleValid: false });
    await expect(svc.accept(invitee, { token: 'tok' })).rejects.toThrow(
      'Unknown role "MANAGER" for this workspace.',
    );
    expect(assertValidRole).toHaveBeenCalledWith('w1', 'MANAGER');
    expect(create).not.toHaveBeenCalled();
  });

  it('still rejects used or expired invitations before looking at the address', async () => {
    const used = build({ invitation: { status: 'ACCEPTED' } });
    await expect(used.svc.accept(invitee, { token: 'tok' })).rejects.toThrow(
      'Invalid or used invitation',
    );
    const expired = build({ invitation: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(expired.svc.accept(invitee, { token: 'tok' })).rejects.toThrow(
      'Invitation expired',
    );
  });
});

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
      membership: { id: 'm1', workspaceId: 'w1', userId: 'u1', role: 'MEMBER' },
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
