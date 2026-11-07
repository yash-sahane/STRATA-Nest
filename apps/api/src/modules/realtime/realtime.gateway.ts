import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { RealtimeAuthService } from './realtime-auth.service';
import { SocketRegistry } from './socket-registry';

/** Close code for a socket whose session ended (4401 is also a refused handshake). */
const SESSION_ENDED = 4401;
/** setTimeout's ceiling (~24.8 days); a longer wait is re-armed rather than overflowing to 1ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Raw-WebSocket gateway at `/ws/collections/` — matches the frontend's native
 * `WebSocket` client and the frame contract:
 *   client → { action: 'subscribe' | 'unsubscribe', channels: [...] }
 *   server → { event, payload, channels, timestamp }
 *
 * Anonymous connections are rejected (close 4401). Subscription is permissive;
 * the security boundary is broadcast-time workspace filtering (see
 * RealtimeService.canReceive), so subscribing to a channel never leaks data.
 */
@WebSocketGateway({ path: '/ws/collections/' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('RealtimeGateway');

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly registry: SocketRegistry,
  ) {}

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    // RC finding (live-verified race): authenticate() awaits a DB round-trip.
    // A client that sends `subscribe` immediately on 'open' (the natural
    // pattern — matches the real frontend client) can have that message
    // arrive before this async function resumes and attaches the 'message'
    // listener below, silently dropping it (no listener = no ack, no error;
    // the client just never receives any broadcasts). Fix: attach the
    // listener SYNCHRONOUSLY first and queue anything that arrives before
    // auth/registration completes, then drain the queue.
    const queued: string[] = [];
    const buffer = (data: RawData): void => {
      queued.push(data.toString());
    };
    socket.on('message', buffer);

    // Nest invokes this from an RxJS subscriber and drops the promise, so a throw
    // here (a malformed cookie, a database blip mid-handshake) was an unhandled
    // rejection — and Node exits on those. One anonymous request with
    // `Cookie: strata_access=%` stopped the API (live-verified). Whatever goes
    // wrong, this socket is refused and the server keeps running.
    let authed: Awaited<ReturnType<RealtimeAuthService['authenticate']>>;
    try {
      authed = await this.auth.authenticate(request);
    } catch (err) {
      this.logger.warn(`Socket handshake failed: ${(err as Error)?.message ?? String(err)}`);
      authed = null;
    }
    if (!authed) {
      socket.off('message', buffer);
      socket.close(SESSION_ENDED);
      return;
    }
    this.registry.add(socket, authed.user, authed.workspaceIds);
    this.closeWhenExpired(socket, authed.expiresAt);

    socket.off('message', buffer);
    socket.on('message', (data: RawData) => this.onMessage(socket, data.toString()));
    for (const raw of queued) this.onMessage(socket, raw);
  }

  /**
   * End the socket when the access token it was opened with ends.
   *
   * The handshake was the only time a socket's session was looked at, so a socket
   * opened before "Log out" went on streaming every frame for as long as the tab
   * stayed open: logging out revokes the refresh token, which a socket never
   * presents. Closing it when its token lapses bounds that to the token's own
   * lifetime; the client renews its session and reconnects with the new cookie.
   */
  private closeWhenExpired(socket: WebSocket, expiresAt: number | undefined): void {
    if (!expiresAt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (): void => {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        timer = setTimeout(check, Math.min(remaining, MAX_TIMER_MS));
        // Never what keeps the process alive at shutdown.
        timer.unref?.();
        return;
      }
      this.registry.remove(socket);
      try {
        socket.close(SESSION_ENDED, 'Session expired');
      } catch {
        /* already gone */
      }
    };
    socket.once('close', () => clearTimeout(timer));
    check();
  }

  handleDisconnect(socket: WebSocket): void {
    this.registry.remove(socket);
  }

  private onMessage(socket: WebSocket, raw: string): void {
    let msg: { action?: string; channels?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const channels = Array.isArray(msg.channels)
      ? msg.channels.filter((c): c is string => typeof c === 'string')
      : [];
    if (msg.action === 'subscribe') this.registry.subscribe(socket, channels);
    else if (msg.action === 'unsubscribe') this.registry.unsubscribe(socket, channels);
  }
}
