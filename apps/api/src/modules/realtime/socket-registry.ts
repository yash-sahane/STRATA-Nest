import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';
import type { User } from '@prisma/client';

export interface SocketInfo {
  user: User;
  /** ACTIVE workspace ids, or `null` for platform admin (all). */
  workspaceIds: Set<string> | null;
  channels: Set<string>;
}

/** In-memory registry of connected sockets and their subscriptions (per instance). */
@Injectable()
export class SocketRegistry {
  private readonly sockets = new Map<WebSocket, SocketInfo>();

  add(socket: WebSocket, user: User, workspaceIds: Set<string> | null): void {
    this.sockets.set(socket, { user, workspaceIds, channels: new Set() });
  }

  remove(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  subscribe(socket: WebSocket, channels: string[]): void {
    const info = this.sockets.get(socket);
    if (info) for (const c of channels) info.channels.add(c);
  }

  unsubscribe(socket: WebSocket, channels: string[]): void {
    const info = this.sockets.get(socket);
    if (info) for (const c of channels) info.channels.delete(c);
  }

  entries(): IterableIterator<[WebSocket, SocketInfo]> {
    return this.sockets.entries();
  }
}
