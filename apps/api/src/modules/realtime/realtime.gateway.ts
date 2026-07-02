import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { RealtimeAuthService } from './realtime-auth.service';
import { SocketRegistry } from './socket-registry';

/**
 * Raw-WebSocket gateway at `/ws/collections/` — matches the frontend's native
 * `WebSocket` client and the frozen frame contract (A§7.1, ADR-0003):
 *   client → { action: 'subscribe' | 'unsubscribe', channels: [...] }
 *   server → { event, payload, channels, timestamp }
 *
 * Anonymous connections are rejected (close 4401). Subscription is permissive;
 * the security boundary is broadcast-time workspace filtering (D2 fix, see
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
    const authed = await this.auth.authenticate(request);
    if (!authed) {
      socket.close(4401);
      return;
    }
    this.registry.add(socket, authed.user, authed.workspaceIds);
    socket.on('message', (data: RawData) => this.onMessage(socket, data.toString()));
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
