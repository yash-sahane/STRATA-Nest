import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type Redis from 'ioredis';
import type { RealtimeFrame } from '@strata/shared';
import { MODEL_COLLECTION } from './realtime.constants';
import { RealtimeService } from './realtime.service';
import { SocketRegistry } from './socket-registry';

describe('MODEL_COLLECTION', () => {
  it('maps domain models to slugs and excludes non-realtime models (User)', () => {
    expect(MODEL_COLLECTION.Task).toBe('tasks');
    expect(MODEL_COLLECTION.WorkspaceMember).toBe('workspace_members');
    expect(MODEL_COLLECTION.User).toBeUndefined();
  });
});

describe('RealtimeService.canReceive (D2 workspace boundary)', () => {
  it('a member receives events only for their workspaces', () => {
    const info = { workspaceIds: new Set(['w1', 'w2']) };
    expect(RealtimeService.canReceive(info, 'w1')).toBe(true);
    expect(RealtimeService.canReceive(info, 'w3')).toBe(false);
  });

  it('a platform admin (null) receives events for any workspace', () => {
    expect(RealtimeService.canReceive({ workspaceIds: null }, 'anything')).toBe(true);
  });

  it('unscoped events (no workspaceId) reach everyone (comments/kanban are never workspace-scoped)', () => {
    expect(RealtimeService.canReceive({ workspaceIds: new Set() }, undefined)).toBe(true);
  });
});

describe('RealtimeService.isAddressedTo (user-scoped collections)', () => {
  const notificationFrame = (userId?: string): RealtimeFrame => ({
    event: 'notifications.create',
    payload: userId === undefined ? { id: 'n1' } : { id: 'n1', userId },
    channels: ['notifications', 'notifications.n1'],
    timestamp: 'x',
  });
  const socketOf = (id: string) => ({ user: { id } as User });

  it('delivers a notification frame only to its recipient', () => {
    expect(RealtimeService.isAddressedTo(socketOf('u1'), notificationFrame('u1'))).toBe(true);
    expect(RealtimeService.isAddressedTo(socketOf('u2'), notificationFrame('u1'))).toBe(false);
  });

  it('fails closed when the frame carries no recipient (delete frames are {id} only)', () => {
    expect(RealtimeService.isAddressedTo(socketOf('u1'), notificationFrame())).toBe(false);
  });

  it('leaves workspace-owned collections untouched', () => {
    const taskFrame: RealtimeFrame = {
      event: 'tasks.update',
      payload: { id: 't1', userId: 'u9' },
      channels: ['tasks', 'tasks.t1'],
      timestamp: 'x',
    };
    expect(RealtimeService.isAddressedTo(socketOf('u1'), taskFrame)).toBe(true);
  });
});

describe('RealtimeService.emit — broadcast filtering', () => {
  class FakeSocket {
    sent: string[] = [];
    send(data: string): void {
      this.sent.push(data);
    }
  }

  function service() {
    const map = new Map<
      FakeSocket,
      { user?: User; workspaceIds: Set<string> | null; channels: Set<string> }
    >();
    const registry = { entries: () => map.entries() } as unknown as SocketRegistry;
    const redis = {
      publish: jest.fn().mockResolvedValue(1),
      duplicate: () => ({ subscribe: jest.fn().mockResolvedValue(1), on: jest.fn() }),
    } as unknown as Redis;
    const prisma = { setWriteHook: jest.fn() } as unknown as PrismaService;
    return { svc: new RealtimeService(redis, registry, prisma), map, redis };
  }

  it('delivers to subscribed + authorized sockets only, and publishes for other instances', () => {
    const { svc, map, redis } = service();
    const s1 = new FakeSocket(); // member of w1, subscribed to tasks
    const s2 = new FakeSocket(); // member of w2, subscribed to tasks
    const s3 = new FakeSocket(); // member of w1, NOT subscribed to tasks
    map.set(s1, { workspaceIds: new Set(['w1']), channels: new Set(['tasks']) });
    map.set(s2, { workspaceIds: new Set(['w2']), channels: new Set(['tasks']) });
    map.set(s3, { workspaceIds: new Set(['w1']), channels: new Set(['projects']) });

    svc.emit(
      { event: 'tasks.update', payload: { id: 't1' }, channels: ['tasks', 'tasks.t1'], timestamp: 'x' },
      'w1',
    );

    expect(s1.sent).toHaveLength(1); // right workspace + subscribed
    expect(s2.sent).toHaveLength(0); // wrong workspace
    expect(s3.sent).toHaveLength(0); // not subscribed to the channel
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it('a notification frame reaches its recipient only, not the rest of the workspace', () => {
    const { svc, map } = service();
    const recipient = new FakeSocket();
    const colleague = new FakeSocket();
    const info = { workspaceIds: new Set(['w1']), channels: new Set(['notifications']) };
    map.set(recipient, { user: { id: 'u1' } as User, ...info });
    map.set(colleague, { user: { id: 'u2' } as User, ...info });

    svc.emit(
      {
        event: 'notifications.create',
        payload: { id: 'n1', userId: 'u1', title: 'Leave Request Rejected' },
        channels: ['notifications', 'notifications.n1'],
        timestamp: 'x',
      },
      'w1',
    );

    expect(recipient.sent).toHaveLength(1);
    expect(colleague.sent).toHaveLength(0);
  });
});

describe('RealtimeService write hook', () => {
  class FakeSocket {
    sent: string[] = [];
    send(data: string): void {
      this.sent.push(data);
    }
    frames(): RealtimeFrame[] {
      return this.sent.map((raw) => JSON.parse(raw) as RealtimeFrame);
    }
  }
  type Hook = (model: string, action: 'create' | 'update' | 'delete', result: unknown) => void;

  function wired() {
    const registry = new SocketRegistry();
    const redis = {
      publish: jest.fn().mockResolvedValue(1),
      duplicate: () => ({ subscribe: jest.fn().mockResolvedValue(1), on: jest.fn() }),
    } as unknown as Redis;
    let hook: Hook | undefined;
    const prisma = {
      setWriteHook: (h: Hook) => {
        hook = h;
      },
    } as unknown as PrismaService;
    new RealtimeService(redis, registry, prisma).onModuleInit();
    const connect = (userId: string, workspaceIds: string[], channels: string[]) => {
      const socket = new FakeSocket();
      registry.add(socket as never, { id: userId } as User, new Set(workspaceIds));
      registry.subscribe(socket as never, channels);
      return socket;
    };
    return { write: hook as Hook, connect };
  }

  it('sends the id alone for a collection the REST API restricts', () => {
    const { write, connect } = wired();
    const member = connect('u1', ['w1'], ['leave_requests', 'invite_codes']);

    write('LeaveRequest', 'create', { id: 'l1', workspaceId: 'w1', userId: 'u2', reason: 'surgery' });
    write('InviteCode', 'create', { id: 'c1', workspaceId: 'w1', code: 'SECRETCODE', role: 'MANAGER' });

    expect(member.frames().map((f) => f.payload)).toEqual([{ id: 'l1' }, { id: 'c1' }]);
  });

  it('never puts an integration credential or a narrowed audit row on the wire', () => {
    const { write, connect } = wired();
    const member = connect('u1', ['w1'], [
      'discord_integrations',
      'github_integrations',
      'gitlab_integrations',
      'activity_logs',
    ]);

    // Rows as the write hook sees them once the workspace has been resolved
    // through the project (WORKSPACE_VIA), which is what let them through.
    write('DiscordIntegration', 'update', {
      id: 'd1', workspaceId: 'w1', projectId: 'p1',
      webhookUrl: 'https://discord.com/api/webhooks/123/SECRET',
    });
    write('GitHubIntegration', 'update', {
      id: 'g1', workspaceId: 'w1', projectId: 'p1', accessToken: 'enc:token', webhookSecret: 'enc:secret',
    });
    write('GitLabIntegration', 'create', {
      id: 'l1', workspaceId: 'w1', projectId: 'p1', accessToken: 'enc:token', webhookSecret: 'enc:secret',
    });
    write('ActivityLog', 'create', {
      id: 'a1', workspaceId: 'w1', userId: 'approver', action: 'leave.rejected',
      metadata: { subjectId: 'u2', reason: 'release week' },
    });

    const payloads = member.frames().map((f) => f.payload);
    expect(payloads).toEqual([{ id: 'd1' }, { id: 'g1' }, { id: 'l1' }, { id: 'a1' }]);
    expect(JSON.stringify(payloads)).not.toMatch(/SECRET|enc:|release week/);
  });

  it('still sends the row where every member may read it', () => {
    const { write, connect } = wired();
    const member = connect('u1', ['w1'], ['tasks']);

    write('Task', 'update', { id: 't1', workspaceId: 'w1', title: 'Ship it' });

    expect(member.frames()[0].payload).toEqual({ id: 't1', workspaceId: 'w1', title: 'Ship it' });
  });

  it.each([
    ['removed', 'delete', 'ACTIVE'],
    ['deactivated', 'update', 'INACTIVE'],
  ] as const)('a %s member gets that frame and nothing after it', (_label, action, status) => {
    const { write, connect } = wired();
    const leaver = connect('u2', ['w1'], ['tasks', 'workspace_members']);

    write('WorkspaceMember', action, { id: 'm1', workspaceId: 'w1', userId: 'u2', status });
    write('Task', 'update', { id: 't1', workspaceId: 'w1', title: 'after' });

    expect(leaver.frames().map((f) => f.event)).toEqual([`workspace_members.${action}`]);
  });

  it('a member added while connected starts receiving that workspace', () => {
    const { write, connect } = wired();
    const joiner = connect('u3', [], ['tasks']);

    write('Task', 'update', { id: 't1', workspaceId: 'w1', title: 'before' });
    write('WorkspaceMember', 'create', { id: 'm2', workspaceId: 'w1', userId: 'u3', status: 'ACTIVE' });
    write('Task', 'update', { id: 't2', workspaceId: 'w1', title: 'after' });

    expect(joiner.frames().map((f) => (f.payload as { id: string }).id)).toEqual(['t2']);
  });
});
