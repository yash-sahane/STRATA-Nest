import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { RealtimeAuthService } from './realtime-auth.service';
import { SocketRegistry } from './socket-registry';

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

    const authed = await this.auth.authenticate(request);
    if (!authed) {
      socket.off('message', buffer);
      socket.close(4401);
      return;
    }
    this.registry.add(socket, authed.user, authed.workspaceIds);

    socket.off('message', buffer);
    socket.on('message', (data: RawData) => this.onMessage(socket, data.toString()));
    for (const raw of queued) this.onMessage(socket, raw);
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
