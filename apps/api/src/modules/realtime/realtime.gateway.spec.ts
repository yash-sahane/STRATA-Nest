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

  // Live-verified: `Cookie: strata_access=%` made authenticate() throw a
  // URIError; Nest drops this promise, so the rejection went unhandled and the
  // API process exited. A handshake that throws must refuse the socket and
  // resolve, never reject.
  it('refuses the socket instead of rejecting when authenticate() throws', async () => {
    const auth = {
      authenticate: jest.fn().mockRejectedValue(new URIError('URI malformed')),
    } as unknown as RealtimeAuthService;
    const registry = new SocketRegistry();
    const gateway = new RealtimeGateway(auth, registry);

    const socket = fakeSocket();
    socket.close = jest.fn();

    await expect(gateway.handleConnection(socket as never, {} as never)).resolves.toBeUndefined();
    expect(socket.close).toHaveBeenCalledWith(4401);
    expect([...registry.entries()]).toHaveLength(0);
  });

  it('reads a malformed cookie as no session rather than throwing', async () => {
    const auth = new RealtimeAuthService(
      { get: (_k: string, d?: unknown) => d } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      auth.authenticate({ headers: { cookie: 'strata_access=%' } } as never),
    ).resolves.toBeNull();
  });
});

/**
 * The handshake was the only time a socket's session was checked, so a socket
 * opened before "Log out" streamed for as long as the tab stayed open.
 */
describe('RealtimeGateway — a socket lasts as long as the token it was opened with', () => {
  afterEach(() => jest.useRealTimers());

  async function connect(expiresAt?: number) {
    const auth = {
      authenticate: jest.fn().mockResolvedValue({ user: { id: 'u1' }, workspaceIds: new Set(['w1']), expiresAt }),
    } as unknown as RealtimeAuthService;
    const registry = new SocketRegistry();
    const socket = new EventEmitter() as EventEmitter & { close: jest.Mock };
    socket.close = jest.fn();
    await new RealtimeGateway(auth, registry).handleConnection(socket as never, {} as never);
    return { socket, registry };
  }

  it('closes the socket when that token expires', async () => {
    jest.useFakeTimers();
    const { socket, registry } = await connect(Date.now() + 60_000);

    jest.advanceTimersByTime(59_999);
    expect(socket.close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(socket.close).toHaveBeenCalledWith(4401, 'Session expired');
    expect([...registry.entries()]).toHaveLength(0);
  });

  it('lets go of the deadline once the socket has closed', async () => {
    jest.useFakeTimers();
    const { socket } = await connect(Date.now() + 60_000);
    socket.emit('close');
    jest.advanceTimersByTime(120_000);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('learns that deadline from the access token the handshake carried', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const auth = new RealtimeAuthService(
      { get: (_k: string, d?: unknown) => d } as never,
      { verify: () => ({ user_id: 'u1', token_type: 'access', jti: 'j', iat: exp - 900, exp }) } as never,
      { user: { findUnique: async () => ({ id: 'u1', isActive: true, hasTempPassword: false }) } } as never,
      { accessibleWorkspaceIds: async () => ['w1'] } as never,
      { revokedBefore: async () => 0 } as never,
    );
    const authed = await auth.authenticate({ headers: { cookie: 'strata_access=token' } } as never);
    expect(authed?.expiresAt).toBe(exp * 1000);
  });

  it('waits out a deadline longer than one timer can hold', async () => {
    jest.useFakeTimers();
    const month = 30 * 24 * 60 * 60 * 1000; // past setTimeout's ~24.8-day ceiling
    const { socket } = await connect(Date.now() + month);
    jest.advanceTimersByTime(month - 1);
    expect(socket.close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(socket.close).toHaveBeenCalledWith(4401, 'Session expired');
  });
});
