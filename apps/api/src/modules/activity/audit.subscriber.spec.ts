import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { HrEvents, WorkspaceEvents } from '@strata/shared';
import { Permission } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ActivityLogsService, type AuditInput } from './activity.services';
import { AuditSubscriber } from './audit.subscriber';

const event = <P>(name: string, payload: P) => ({
  name,
  workspaceId: 'w1',
  payload,
  occurredAt: new Date().toISOString(),
});

function subscriber() {
  const recorded: AuditInput[] = [];
  const activity = { record: jest.fn(async (input: AuditInput) => void recorded.push(input)) };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Asha', email: 'asha@x.test' }) },
  };
  const sub = new AuditSubscriber(
    activity as unknown as ActivityLogsService,
    prisma as unknown as PrismaService,
  );
  return { sub, recorded };
}

describe('AuditSubscriber — who did it, and to whom', () => {
  it('credits the person who added a member, and names the member', async () => {
    const { sub, recorded } = subscriber();
    await sub.onMemberAdded(
      event(WorkspaceEvents.MemberAdded, { workspaceId: 'w1', userId: 'u-asha', role: 'TESTER', via: 'direct', actorId: 'u-mgr' }),
    );
    expect(recorded[0]).toMatchObject({
      userId: 'u-mgr',
      entityId: 'u-asha',
      metadata: { subjectId: 'u-asha', label: 'Asha', role: 'TESTER', via: 'direct' },
    });
  });

  it('records access being switched off, by whom', async () => {
    const { sub, recorded } = subscriber();
    await sub.onStatusChanged(
      event(WorkspaceEvents.MemberStatusChanged, {
        workspaceId: 'w1', userId: 'u-asha', status: 'INACTIVE', previousStatus: 'ACTIVE', actorId: 'u-mgr',
      }),
    );
    expect(recorded[0]).toMatchObject({
      userId: 'u-mgr',
      action: WorkspaceEvents.MemberStatusChanged,
      changes: { status: ['ACTIVE', 'INACTIVE'] },
      metadata: { subjectId: 'u-asha' },
    });
  });

  it('credits a leave decision to the approver, with nothing about the leave itself', async () => {
    const { sub, recorded } = subscriber();
    await sub.onLeaveRejected(
      event(HrEvents.LeaveRejected, {
        workspaceId: 'w1', userId: 'u-asha', leaveRequestId: 'lr1', approverId: 'u-mgr', type: 'SICK', daysCount: 2,
      }),
    );
    expect(recorded[0]).toMatchObject({ userId: 'u-mgr', entityId: 'lr1', metadata: { subjectId: 'u-asha' } });
    expect(Object.keys(recorded[0].metadata ?? {})).toEqual(['subjectId']);
  });

  it('falls back to the subject for an event from before events carried their actor', async () => {
    const { sub, recorded } = subscriber();
    await sub.onMemberRemoved(
      event(WorkspaceEvents.MemberRemoved, { workspaceId: 'w1', userId: 'u-asha', role: 'TESTER', via: 'left' }),
    );
    expect(recorded[0].userId).toBe('u-asha');
  });
});

describe('ActivityLogsService — leave and time rows are not everybody\'s', () => {
  const reader = { id: 'u-dev' } as User;

  function service(approves: Partial<Record<string, string[]>>) {
    const access = {
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1', 'w2'] } }),
      accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1', 'w2']),
      can: jest.fn(async (_u: User, ws: string, permission: string) => (approves[permission] ?? []).includes(ws)),
    };
    return new ActivityLogsService({} as PrismaService, access as unknown as WorkspaceAccessService);
  }
  const scopeOf = (svc: ActivityLogsService) =>
    (svc as unknown as { readScope(u: User): Promise<Record<string, unknown>> }).readScope(reader);

  it('a member reads every other row, and only their own leave and time rows', async () => {
    const where = (await scopeOf(service({}))) as { AND: [unknown, { OR: Record<string, unknown>[] }] };
    const [, { OR }] = where.AND;
    expect(OR).toEqual(
      expect.arrayContaining([
        { entityType: { notIn: ['leave_request', 'leave_balance', 'time_entry'] } },
        { userId: 'u-dev' },
        { metadata: { path: ['subjectId'], equals: 'u-dev' } },
        { entityType: { in: ['leave_request', 'leave_balance'] }, workspaceId: { in: [] } },
        { entityType: { in: ['time_entry'] }, workspaceId: { in: [] } },
      ]),
    );
  });

  it('an approver reads them in the workspaces they approve in, and only those', async () => {
    const where = (await scopeOf(
      service({ [Permission.LeaveApprove]: ['w2'], [Permission.TimeApprove]: ['w1', 'w2'] }),
    )) as { AND: [unknown, { OR: Record<string, unknown>[] }] };
    const [, { OR }] = where.AND;
    expect(OR).toContainEqual({ entityType: { in: ['leave_request', 'leave_balance'] }, workspaceId: { in: ['w2'] } });
    expect(OR).toContainEqual({ entityType: { in: ['time_entry'] }, workspaceId: { in: ['w1', 'w2'] } });
  });
});
