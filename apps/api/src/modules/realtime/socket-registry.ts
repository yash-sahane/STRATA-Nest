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

  /**
   * Bring a user's open sockets in step with a membership change.
   *
   * `workspaceIds` is read once, at connect. Without this a member removed from a
   * workspace (or deactivated in it) kept receiving its frames for as long as the
   * tab stayed open, and a member just added received none until they reloaded.
   * Platform admins (`null`) are not membership-scoped and are left alone.
   */
  setMembership(userId: string, workspaceId: string, active: boolean): void {
    for (const info of this.sockets.values()) {
      if (info.user.id !== userId || info.workspaceIds === null) continue;
      if (active) info.workspaceIds.add(workspaceId);
      else info.workspaceIds.delete(workspaceId);
    }
  }

  /**
   * Close every socket a user has open here. The client reconnects with
   * whatever session it now holds — a new one after changing its own password,
   * none after a reset or deactivation, which the handshake then refuses.
   */
  closeUser(userId: string): void {
    for (const [socket, info] of this.sockets) {
      if (info.user.id !== userId) continue;
      this.sockets.delete(socket);
      try {
        socket.close(4401, 'Session ended');
      } catch {
        /* already gone */
      }
    }
  }

  entries(): IterableIterator<[WebSocket, SocketInfo]> {
    return this.sockets.entries();
  }
}
