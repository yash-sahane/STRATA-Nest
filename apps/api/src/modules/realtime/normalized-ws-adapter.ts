import type { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';

/**
 * RC finding (live-verified, critical): `@nestjs/platform-ws`'s WsAdapter
 * registers each gateway's path via `normalizePath()`, which STRIPS a trailing
 * slash (`/ws/collections/` → `/ws/collections`). Its upgrade handler then
 * compares that normalized path against the RAW incoming request pathname
 * (not normalized) with strict `===`. The real frontend connects to
 * `${WS_BASE}/ws/collections/` (WITH a trailing slash, ws/api/realtime-client.ts)
 * — every connection was silently rejected (`socket.destroy()`, no response,
 * no log; a bare TCP reset). Confirmed live: curl upgrade to `/ws/collections`
 * (no slash) → 101; to `/ws/collections/` (matching the actual client) → reset.
 *
 * Fix: normalize the incoming pathname the same way before comparing, without
 * touching the vendored package. `ensureHttpServerExists`'s body is small
 * enough to override safely; behavior is otherwise identical to the base class.
 */
export class NormalizedWsAdapter extends WsAdapter {
  constructor(appOrHttpServer: INestApplicationContext) {
    super(appOrHttpServer);
  }

  // Base signature declares a non-optional return type, but the original
  // implementation returns `undefined` at runtime on the early-exit branch
  // (already-registered port) — matched here to keep that exact behavior.
  protected ensureHttpServerExists(port: number, httpServer?: HttpServer): HttpServer {
    const registry = (this as unknown as { httpServersRegistry: Map<number, HttpServer> })
      .httpServersRegistry;
    const wsRegistry = (
      this as unknown as { wsServersRegistry: Map<number, Array<{ path: string; handleUpgrade: Function; emit: Function }>> }
    ).wsServersRegistry;

    if (registry.has(port)) return undefined as unknown as HttpServer;
    const server = httpServer ?? (require('node:http').createServer() as HttpServer);
    registry.set(port, server);

    server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      try {
        const baseUrl = `ws://${request.headers.host}/`;
        const rawPathname = new URL(request.url ?? '', baseUrl).pathname;
        // The one-line fix: strip a trailing slash the same way normalizePath does,
        // so `/ws/collections/` matches the gateway registered as `/ws/collections`.
        const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, '') : rawPathname;
        const wsServers = wsRegistry.get(port) ?? [];
        const target = wsServers.find((s) => s.path === pathname);
        if (target) {
          target.handleUpgrade(request, socket, head, (ws: unknown) => target.emit('connection', ws, request));
        } else {
          socket.destroy();
        }
      } catch (err) {
        socket.end(`HTTP/1.1 400\r\n${(err as Error).message}`);
      }
    });
    return server as HttpServer;
  }
}
