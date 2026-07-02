import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '@lt/prisma';
import { HrEvents, type DomainEvent, type LeaveDecisionPayload } from '@lt/shared';
import { ActivityLogsService } from './activity.services';
import { AuditSubscriber } from './audit.subscriber';

describe('ActivityLogsService — append-only (D9)', () => {
  const svc = new ActivityLogsService({} as unknown as PrismaService, {} as never);

  it('rejects UPDATE', () => {
    expect(() => svc.update()).toThrow(ForbiddenException);
    expect(() => svc.update()).toThrow(/append-only/i);
  });

  it('rejects DELETE', () => {
    expect(() => svc.remove()).toThrow(ForbiddenException);
    expect(() => svc.remove()).toThrow(/append-only/i);
  });

  it('record() appends an immutable audit row', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'a1' });
    const svc2 = new ActivityLogsService(
      { activityLog: { create } } as unknown as PrismaService,
      {} as never,
    );
    await svc2.record({
      workspaceId: 'w1',
      userId: 'u2',
      action: HrEvents.LeaveApproved,
      entityType: 'leave_request',
      entityId: 'lr1',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'w1',
          action: HrEvents.LeaveApproved,
          entityType: 'leave_request',
          entityId: 'lr1',
        }),
      }),
    );
  });
});

describe('AuditSubscriber', () => {
  const leaveEvent: DomainEvent<LeaveDecisionPayload> = {
    name: HrEvents.LeaveApproved,
    workspaceId: 'w1',
    payload: { workspaceId: 'w1', userId: 'u2', leaveRequestId: 'lr1', type: 'CASUAL', daysCount: 2 },
    occurredAt: new Date().toISOString(),
  };

  it('appends an audit row keyed by the event name and entity', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const sub = new AuditSubscriber({ record } as never);
    await sub.onLeaveApproved(leaveEvent);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: HrEvents.LeaveApproved,
        entityType: 'leave_request',
        entityId: 'lr1',
      }),
    );
  });

  it('swallows audit-write failures (never breaks the request)', async () => {
    const record = jest.fn().mockRejectedValue(new Error('db down'));
    const sub = new AuditSubscriber({ record } as never);
    await expect(sub.onLeaveApproved(leaveEvent)).resolves.toBeUndefined();
  });
});
