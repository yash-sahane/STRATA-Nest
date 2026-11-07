import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ActivityLogsService } from './activity.services';

const member = { id: 'u1' } as User;

function build() {
  const groupBy = jest
    .fn()
    .mockResolvedValue([{ action: 'leave.approved' }, { action: 'task.created' }]);
  const prisma = { activityLog: { groupBy } } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1', 'w2'] } }),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1', 'w2']),
    // Approves leave in w1 only.
    can: jest.fn((_user: User, workspaceId: string, permission: string) =>
      Promise.resolve(workspaceId === 'w1' && permission === 'leave:approve'),
    ),
  } as unknown as WorkspaceAccessService;
  return { svc: new ActivityLogsService(prisma, access), groupBy };
}

describe('ActivityLogsService.actions — the feed’s filter options', () => {
  it('lists every distinct action, however old, grouped rather than paged', async () => {
    const { svc, groupBy } = build();
    await expect(svc.actions(member, { workspaceId: 'w1' })).resolves.toEqual({
      actions: ['leave.approved', 'task.created'],
    });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['action'], orderBy: { action: 'asc' } }),
    );
    expect(groupBy.mock.calls[0][0]).not.toHaveProperty('take');
  });

  it('reads only what the list would show the caller: its read scope and allowlisted filters', async () => {
    const { svc, groupBy } = build();
    await svc.actions(member, { workspaceId: 'w1', changes: 'x' });

    const { where } = groupBy.mock.calls[0][0] as { where: { AND: unknown[] } };
    // Leave and time rows narrowed exactly as the list narrows them, so the
    // options never name an action the caller could not open.
    expect(where.AND[0]).toEqual(await (svc as unknown as { readScope(u: User): Promise<unknown> }).readScope(member));
    expect(where.AND[0]).toEqual({
      AND: [
        { workspaceId: { in: ['w1', 'w2'] } },
        {
          OR: expect.arrayContaining([
            { userId: 'u1' },
            { entityType: { in: ['leave_request', 'leave_balance'] }, workspaceId: { in: ['w1'] } },
            { entityType: { in: ['time_entry'] }, workspaceId: { in: [] } },
          ]),
        },
      ],
    });
    // The query's filters pass the allowlist — an unknown key does not.
    expect(where.AND[1]).toEqual({ workspaceId: 'w1' });
  });
});
