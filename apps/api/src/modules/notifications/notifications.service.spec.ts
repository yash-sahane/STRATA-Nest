import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { HrEvents, WorkspaceEvents, type DomainEvent, type LeaveDecisionPayload } from '@strata/shared';
import { NotificationSubscriber } from './notification.subscriber';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';

const user = { id: 'u1' } as User;

/** Preference gate stub — `allows` defaults to "no preference set". */
const prefs = (allows = true) =>
  ({ allows: jest.fn().mockResolvedValue(allows) }) as unknown as NotificationPreferencesService;

describe('NotificationsService.markAllRead', () => {
  it('marks the caller’s unread notifications read and returns { updated }', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma = { notification: { updateMany } } as unknown as PrismaService;
    const access = { scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }) } as never;
    const svc = new NotificationsService(prisma, access, prefs());

    const res = await svc.markAllRead(user);

    expect(res).toEqual({ updated: 3 });
    // By recipient, and nothing else: a notice filed under a workspace the
    // person has since been removed from is still theirs to clear.
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isRead: false },
      data: { isRead: true },
    });
  });
});

describe('NotificationsService.list (recipient-only)', () => {
  function svcWith() {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { notification: { findMany, count } } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
      isPlatformAdmin: (u: User) => u.isSuperuser === true,
    } as never;
    return { svc: new NotificationsService(prisma, access, prefs()), findMany };
  }

  it('forces the caller as recipient, ignoring ?userId=<victim>', async () => {
    const { svc, findMany } = svcWith();

    await svc.list(user, { userId: 'victim' });

    // Scoped by recipient twice over — the read scope and the forced filter —
    // and by no workspace: "you were removed from X" is filed under X, which
    // its recipient can no longer see into.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ userId: 'u1' }, { userId: 'u1' }] },
      }),
    );
  });

  it('ignores suffixed recipient filters too (userId__in)', async () => {
    const { svc, findMany } = svcWith();

    await svc.list(user, { userId__in: 'victim,other' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ userId: 'u1' }, { userId: 'u1' }] },
      }),
    );
  });

  it('lets a platform admin filter by any recipient', async () => {
    const admin = { id: 'a1', isSuperuser: true } as User;
    const { svc, findMany } = svcWith();

    await svc.list(admin, { userId: 'u2' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ workspaceId: { in: ['w1'] } }, { userId: 'u2' }] },
      }),
    );
  });
});

describe('NotificationsService.deliver (D9 server-guaranteed)', () => {
  it('writes the in-app notification', async () => {
    const notifCreate = jest.fn().mockResolvedValue({ id: 'n1' });
    const prisma = { notification: { create: notifCreate } } as unknown as PrismaService;
    const svc = new NotificationsService(prisma, {} as never, prefs());

    await svc.deliver({ workspaceId: 'w1', userId: 'u2', type: 'LEAVE_APPROVED', title: 't', message: 'm' });

    expect(notifCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u2', type: 'LEAVE_APPROVED' }),
      }),
    );
  });
});

describe('NotificationsService honours the recipient’s in-app opt-out', () => {
  function svcWith(allowed: boolean) {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const notifCreate = jest.fn().mockResolvedValue({ id: 'n1', createdAt: now, updatedAt: now });
    const prisma = { notification: { create: notifCreate } } as unknown as PrismaService;
    const assertPermission = jest.fn().mockResolvedValue(undefined);
    const access = {
      assertPermission,
      isPlatformAdmin: (u: User) => Boolean(u.isSuperuser),
    } as never;
    const preferences = prefs(allowed);
    return { svc: new NotificationsService(prisma, access, preferences), notifCreate, assertPermission, preferences };
  }

  // A note to self — the only notification a member may write (see below).
  const dto = {
    workspaceId: 'w1',
    userId: 'u1',
    type: 'ATTENDANCE_LATE',
    title: 't',
    message: 'm',
  };

  it('deliver() writes nothing when the recipient muted the type', async () => {
    const { svc, notifCreate } = svcWith(false);

    await svc.deliver({ workspaceId: 'w1', userId: 'u2', type: 'LEAVE_APPROVED', title: 't', message: 'm' });

    expect(notifCreate).not.toHaveBeenCalled();
  });

  it('create() drops a muted notification instead of persisting it', async () => {
    const { svc, notifCreate, preferences } = svcWith(false);

    await expect(svc.create(user, dto)).resolves.toBeNull();

    expect(notifCreate).not.toHaveBeenCalled();
    expect(preferences.allows).toHaveBeenCalledWith('w1', 'u1', 'ATTENDANCE_LATE', 'inApp');
  });

  it('create() still asserts the write permission when it drops one', async () => {
    const { svc, assertPermission } = svcWith(false);

    await svc.create(user, dto);

    expect(assertPermission).toHaveBeenCalledWith(user, 'w1', expect.any(String));
  });

  it('create() persists normally when no preference is set', async () => {
    const { svc, notifCreate } = svcWith(true);

    await svc.create(user, dto);

    expect(notifCreate).toHaveBeenCalledTimes(1);
  });

  it('create() refuses a notification addressed to somebody else', async () => {
    const { svc, notifCreate, preferences } = svcWith(true);

    await expect(
      svc.create(user, { ...dto, userId: 'u2', type: 'LEAVE_APPROVED', title: 'Leave approved' }),
    ).rejects.toThrow('You do not have permission to perform this action.');

    expect(notifCreate).not.toHaveBeenCalled();
    // Refused before anything about the would-be recipient is looked up.
    expect(preferences.allows).not.toHaveBeenCalled();
  });

  it('create() still lets a platform admin address anybody (seeding, support)', async () => {
    const { svc, notifCreate } = svcWith(true);

    await svc.create({ id: 'admin', isSuperuser: true } as User, { ...dto, userId: 'u2' });

    expect(notifCreate).toHaveBeenCalledTimes(1);
  });
});

/** The subscriber's two lookups: a workspace's name, and who can decide a request. */
function subscriber(deliver: jest.Mock, reviewers: string[] = []) {
  const prisma = {
    workspace: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme' }) },
  } as unknown as PrismaService;
  const access = { membersHolding: jest.fn().mockResolvedValue(reviewers) };
  return {
    sub: new NotificationSubscriber({ deliver } as never, prisma, access as never),
    access,
  };
}

describe('NotificationSubscriber', () => {
  const leaveEvent: DomainEvent<LeaveDecisionPayload> = {
    name: HrEvents.LeaveApproved,
    workspaceId: 'w1',
    payload: { workspaceId: 'w1', userId: 'u2', leaveRequestId: 'lr1', type: 'CASUAL', daysCount: 2 },
    occurredAt: new Date().toISOString(),
  };

  it('turns leave.approved into a notification addressed to the requester', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const { sub } = subscriber(deliver);

    await sub.onLeaveApproved(leaveEvent);

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        userId: 'u2',
        type: 'LEAVE_APPROVED',
        relatedEntityId: 'lr1',
        relatedEntityType: 'leave_request',
      }),
    );
  });

  it('never propagates a delivery failure back into the request', async () => {
    const deliver = jest.fn().mockRejectedValue(new Error('db down'));
    const { sub } = subscriber(deliver);
    await expect(sub.onLeaveApproved(leaveEvent)).resolves.toBeUndefined();
  });

  it('notifies the added member on workspace.member.added', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const { sub } = subscriber(deliver);
    await sub.onMemberAdded({
      name: WorkspaceEvents.MemberAdded,
      workspaceId: 'w1',
      payload: { workspaceId: 'w1', userId: 'u9', role: 'MEMBER', via: 'direct' },
      occurredAt: new Date().toISOString(),
    });
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u9', type: 'WORKSPACE_MEMBER_ADDED' }),
    );
  });

  // Whoever made the workspace or redeemed a code did it themselves, and an
  // approved request has its own notice: "you were added" would repeat it.
  it.each(['invite', 'join', 'created'] as const)('says nothing to a member who joined %s', async (via) => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const { sub } = subscriber(deliver);
    await sub.onMemberAdded({
      name: WorkspaceEvents.MemberAdded,
      workspaceId: 'w1',
      payload: { workspaceId: 'w1', userId: 'u9', role: 'MEMBER', via },
      occurredAt: new Date().toISOString(),
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('names the workspace and the role, since the list spans every workspace', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const { sub } = subscriber(deliver);
    await sub.onMemberAdded({
      name: WorkspaceEvents.MemberAdded,
      workspaceId: 'w1',
      payload: { workspaceId: 'w1', userId: 'u9', role: 'SOFTWARE_DEVELOPER', via: 'direct' },
      occurredAt: new Date().toISOString(),
    });
    expect(deliver.mock.calls[0][0].message).toBe('You were added to "Acme" as Software Developer.');
  });

  it('tells everyone who can decide a join request, and only them', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const { sub, access } = subscriber(deliver, ['m1', 'm2']);
    await sub.onJoinRequested({
      name: WorkspaceEvents.JoinRequestCreated,
      workspaceId: 'w1',
      payload: {
        workspaceId: 'w1',
        userId: 'u9',
        requestId: 'j1',
        requesterName: 'Asha Rao',
        workspaceName: 'Acme',
      },
      occurredAt: new Date().toISOString(),
    });
    expect(access.membersHolding).toHaveBeenCalledWith('w1', 'join:manage');
    expect(deliver.mock.calls.map((c) => c[0].userId)).toEqual(['m1', 'm2']);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'JOIN_REQUEST_RECEIVED',
        message: 'Asha Rao asked to join "Acme".',
        relatedEntityId: 'j1',
        relatedEntityType: 'join_request',
      }),
    );
  });
});
