import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type Redis from 'ioredis';
import type { RealtimeFrame } from '@strata/shared';
import { MODEL_COLLECTION } from './realtime.constants';
import { RealtimeService } from './realtime.service';
import type { SocketRegistry } from './socket-registry';

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
