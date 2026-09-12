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
    expect(updateMany).toHaveBeenCalledWith({
      where: { AND: [{ workspaceId: { in: ['w1'] } }, { userId: 'u1', isRead: false }] },
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

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ workspaceId: { in: ['w1'] } }, { userId: 'u1' }] },
      }),
    );
  });

  it('ignores suffixed recipient filters too (userId__in)', async () => {
    const { svc, findMany } = svcWith();

    await svc.list(user, { userId__in: 'victim,other' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ workspaceId: { in: ['w1'] } }, { userId: 'u1' }] },
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
  it('writes the in-app notification AND its in_app delivery row', async () => {
    const notifCreate = jest.fn().mockResolvedValue({ id: 'n1' });
    const deliveryCreate = jest.fn().mockResolvedValue({ id: 'd1' });
    const prisma = {
      notification: { create: notifCreate },
      notificationDelivery: { create: deliveryCreate },
    } as unknown as PrismaService;
    const svc = new NotificationsService(prisma, {} as never, prefs());

    await svc.deliver({ workspaceId: 'w1', userId: 'u2', type: 'leave_approved', title: 't', message: 'm' });

    expect(notifCreate).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notificationId: 'n1', channel: 'in_app', status: 'delivered' }),
      }),
    );
  });
});

describe('NotificationsService honours the recipient’s in-app opt-out', () => {
  function svcWith(allowed: boolean) {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const notifCreate = jest.fn().mockResolvedValue({ id: 'n1', createdAt: now, updatedAt: now });
    const deliveryCreate = jest.fn().mockResolvedValue({ id: 'd1' });
    const prisma = {
      notification: { create: notifCreate },
      notificationDelivery: { create: deliveryCreate },
    } as unknown as PrismaService;
    const assertPermission = jest.fn().mockResolvedValue(undefined);
    const access = { assertPermission } as never;
    const preferences = prefs(allowed);
    return { svc: new NotificationsService(prisma, access, preferences), notifCreate, assertPermission, preferences };
  }

  const dto = {
    workspaceId: 'w1',
    userId: 'u2',
    type: 'TASK_ASSIGNED',
    title: 't',
    message: 'm',
  };

  it('deliver() writes nothing when the recipient muted the type', async () => {
    const { svc, notifCreate } = svcWith(false);

    await svc.deliver({ workspaceId: 'w1', userId: 'u2', type: 'leave_approved', title: 't', message: 'm' });

    expect(notifCreate).not.toHaveBeenCalled();
  });

  it('create() drops a muted notification instead of persisting it', async () => {
    const { svc, notifCreate, preferences } = svcWith(false);

    await expect(svc.create(user, dto)).resolves.toBeNull();

    expect(notifCreate).not.toHaveBeenCalled();
    expect(preferences.allows).toHaveBeenCalledWith('w1', 'u2', 'TASK_ASSIGNED', 'inApp');
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
});

describe('NotificationSubscriber', () => {
  const leaveEvent: DomainEvent<LeaveDecisionPayload> = {
    name: HrEvents.LeaveApproved,
    workspaceId: 'w1',
    payload: { workspaceId: 'w1', userId: 'u2', leaveRequestId: 'lr1', type: 'CASUAL', daysCount: 2 },
    occurredAt: new Date().toISOString(),
  };

  it('turns leave.approved into a notification addressed to the requester', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const sub = new NotificationSubscriber({ deliver } as never);

    await sub.onLeaveApproved(leaveEvent);

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        userId: 'u2',
        type: 'leave_approved',
        relatedEntityId: 'lr1',
        relatedEntityType: 'leave_request',
      }),
    );
  });

  it('never propagates a delivery failure back into the request', async () => {
    const deliver = jest.fn().mockRejectedValue(new Error('db down'));
    const sub = new NotificationSubscriber({ deliver } as never);
    await expect(sub.onLeaveApproved(leaveEvent)).resolves.toBeUndefined();
  });

  it('notifies the added member on workspace.member.added', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const sub = new NotificationSubscriber({ deliver } as never);
    await sub.onMemberAdded({
      name: WorkspaceEvents.MemberAdded,
      workspaceId: 'w1',
      payload: { workspaceId: 'w1', userId: 'u9', role: 'MEMBER', via: 'invite' },
      occurredAt: new Date().toISOString(),
    });
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u9', type: 'workspace_member_added' }),
    );
  });
});
