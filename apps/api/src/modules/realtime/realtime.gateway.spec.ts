import { EventEmitter } from 'node:events';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeAuthService } from './realtime-auth.service';
import { SocketRegistry } from './socket-registry';

/**
 * RC finding (live-verified race): `handleConnection` is async and awaits a DB
 * round-trip in `authenticate()` before attaching the 'message' listener. A
 * client subscribing immediately on 'open' (the real frontend's pattern) could
 * have that message arrive and be silently dropped before the listener existed.
 * Confirmed live: an immediate subscribe never delivered a frame; a 1s-delayed
 * subscribe did. Fixed by attaching the listener synchronously and queuing.
 */
describe('RealtimeGateway.handleConnection — subscribe-before-auth-resolves race', () => {
  function fakeSocket() {
    return new EventEmitter() as EventEmitter & { close: jest.Mock; off: EventEmitter['off'] };
  }

  it('does not lose a subscribe message sent before authenticate() resolves', async () => {
    const user = { id: 'u1' };
    let resolveAuth: (v: unknown) => void = () => undefined;
    const auth = {
      authenticate: jest.fn(() => new Promise((resolve) => { resolveAuth = resolve; })),
    } as unknown as RealtimeAuthService;
    const registry = new SocketRegistry();
    const gateway = new RealtimeGateway(auth, registry);

    const socket = fakeSocket();
    socket.close = jest.fn();

    const connectionPromise = gateway.handleConnection(socket as never, {} as never);

    // Client sends `subscribe` before the (still-pending) DB-backed auth resolves —
    // this is the exact race that dropped the message before the fix.
    socket.emit('message', Buffer.from(JSON.stringify({ action: 'subscribe', channels: ['projects'] })));

    resolveAuth({ user, workspaceIds: new Set(['w1']) });
    await connectionPromise;

    const [, info] = [...registry.entries()][0];
    expect(info.channels.has('projects')).toBe(true);
  });

  it('still processes subscribes sent after connection is fully established', async () => {
    const user = { id: 'u1' };
    const auth = {
      authenticate: jest.fn().mockResolvedValue({ user, workspaceIds: new Set(['w1']) }),
    } as unknown as RealtimeAuthService;
    const registry = new SocketRegistry();
    const gateway = new RealtimeGateway(auth, registry);

    const socket = fakeSocket();
    socket.close = jest.fn();
    await gateway.handleConnection(socket as never, {} as never);

    socket.emit('message', Buffer.from(JSON.stringify({ action: 'subscribe', channels: ['tasks'] })));

    const [, info] = [...registry.entries()][0];
    expect(info.channels.has('tasks')).toBe(true);
  });

  it('closes with 4401 and never registers on failed auth, even with a queued message', async () => {
    const auth = { authenticate: jest.fn().mockResolvedValue(null) } as unknown as RealtimeAuthService;
    const registry = new SocketRegistry();
    const gateway = new RealtimeGateway(auth, registry);

    const socket = fakeSocket();
    socket.close = jest.fn();
    const p = gateway.handleConnection(socket as never, {} as never);
    socket.emit('message', Buffer.from(JSON.stringify({ action: 'subscribe', channels: ['projects'] })));
    await p;

    expect(socket.close).toHaveBeenCalledWith(4401);
    expect([...registry.entries()]).toHaveLength(0);
  });
});
