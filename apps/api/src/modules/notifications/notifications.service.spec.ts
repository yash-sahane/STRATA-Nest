import type { PrismaService } from '@lt/prisma';
import type { User } from '@prisma/client';
import { HrEvents, WorkspaceEvents, type DomainEvent, type LeaveDecisionPayload } from '@lt/shared';
import { NotificationSubscriber } from './notification.subscriber';
import { NotificationsService } from './notifications.service';

const user = { id: 'u1' } as User;

describe('NotificationsService.markAllRead', () => {
  it('marks the caller’s unread notifications read and returns { updated }', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma = { notification: { updateMany } } as unknown as PrismaService;
    const access = { scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }) } as never;
    const svc = new NotificationsService(prisma, access);

    const res = await svc.markAllRead(user);

    expect(res).toEqual({ updated: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { AND: [{ workspaceId: { in: ['w1'] } }, { userId: 'u1', isRead: false }] },
      data: { isRead: true },
    });
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
    const svc = new NotificationsService(prisma, {} as never);

    await svc.deliver({ workspaceId: 'w1', userId: 'u2', type: 'leave_approved', title: 't', message: 'm' });

    expect(notifCreate).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notificationId: 'n1', channel: 'in_app', status: 'delivered' }),
      }),
    );
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
