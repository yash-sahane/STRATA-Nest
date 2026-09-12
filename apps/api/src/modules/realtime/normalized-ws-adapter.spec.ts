import { EventEmitter } from 'node:events';
import { NormalizedWsAdapter } from './normalized-ws-adapter';

/**
 * RC finding: the stock WsAdapter registers a gateway's path with a trailing
 * slash stripped (`normalizePath`), but never strips it from the incoming
 * request's pathname before comparing — so a client connecting to the
 * documented/frontend URL (WITH a trailing slash) was silently disconnected
 * (`socket.destroy()`). This test drives the real 'upgrade' handler our
 * override installs and asserts a trailing-slash request now matches.
 */
/** The protected method under test, reached through a cast. */
interface EnsureHttpServer {
  ensureHttpServerExists(port: number, httpServer?: unknown): void;
}

describe('NormalizedWsAdapter (RC — trailing-slash WS path fix)', () => {
  function buildAdapter() {
    const adapter = Object.create(NormalizedWsAdapter.prototype) as NormalizedWsAdapter;
    const target = { path: '/ws/collections', handleUpgrade: jest.fn(), emit: jest.fn() };
    (adapter as unknown as { httpServersRegistry: Map<number, unknown> }).httpServersRegistry = new Map();
    (adapter as unknown as { wsServersRegistry: Map<number, unknown[]> }).wsServersRegistry = new Map([
      [0, [target]],
    ]);
    return { adapter, target };
  }

  function fakeHttpServer() {
    const server = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
    return server;
  }

  it('routes a request whose path has a trailing slash to the registered (slash-less) gateway', () => {
    const { adapter, target } = buildAdapter();
    const httpServer = fakeHttpServer();
    (adapter as unknown as EnsureHttpServer).ensureHttpServerExists(0, httpServer);

    const socket = { destroy: jest.fn(), end: jest.fn() };
    const request = { headers: { host: 'localhost:8000' }, url: '/ws/collections/' };
    httpServer.emit('upgrade', request, socket, Buffer.alloc(0));

    expect(target.handleUpgrade).toHaveBeenCalledWith(request, socket, Buffer.alloc(0), expect.any(Function));
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('still routes a request without a trailing slash (unaffected)', () => {
    const { adapter, target } = buildAdapter();
    const httpServer = fakeHttpServer();
    (adapter as unknown as EnsureHttpServer).ensureHttpServerExists(0, httpServer);

    const socket = { destroy: jest.fn() };
    const request = { headers: { host: 'localhost:8000' }, url: '/ws/collections' };
    httpServer.emit('upgrade', request, socket, Buffer.alloc(0));

    expect(target.handleUpgrade).toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('destroys the socket for a genuinely unknown path', () => {
    const { adapter, target } = buildAdapter();
    const httpServer = fakeHttpServer();
    (adapter as unknown as EnsureHttpServer).ensureHttpServerExists(0, httpServer);

    const socket = { destroy: jest.fn() };
    const request = { headers: { host: 'localhost:8000' }, url: '/not-a-gateway/' };
    httpServer.emit('upgrade', request, socket, Buffer.alloc(0));

    expect(target.handleUpgrade).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalled();
  });
});
