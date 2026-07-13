import type { PrismaService } from '@strata/prisma';
import type Redis from 'ioredis';
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

describe('RealtimeService.emit — broadcast filtering', () => {
  class FakeSocket {
    sent: string[] = [];
    send(data: string): void {
      this.sent.push(data);
    }
  }

  function service() {
    const map = new Map<FakeSocket, { workspaceIds: Set<string> | null; channels: Set<string> }>();
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
});
