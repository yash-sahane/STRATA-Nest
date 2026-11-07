import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TokenService } from '../auth/services/token.service';
import { RefreshTokenStore } from '../auth/services/refresh-token.store';

export interface AuthedSocket {
  user: User;
  /** ACTIVE workspace ids, or `null` for platform admin (all). */
  workspaceIds: Set<string> | null;
  /** When the access token the socket was opened with lapses, in ms since the epoch. */
  expiresAt?: number;
}

/** Authenticates a WebSocket upgrade using the `strata_access` cookie (no `?token=`). */
@Injectable()
export class RealtimeAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly sessions: RefreshTokenStore,
  ) {}

  async authenticate(request: IncomingMessage): Promise<AuthedSocket | null> {
    // The rule originCheck applies to every write. A socket is opened with the
    // session cookie alone, which a browser attaches for any page that asks —
    // so with JWT_COOKIE_SAMESITE=None another site could open one in a
    // visitor's name and read every live frame of every workspace they are in.
    if (!this.originAllowed(request)) return null;
    const cookieName = this.config.get<string>('JWT_ACCESS_COOKIE_NAME', 'strata_access');
    const token = this.readCookie(request, cookieName);
    if (!token) return null;

    let claims;
    try {
      claims = this.tokens.verify(token);
    } catch {
      return null;
    }
    if (claims.token_type !== 'access') return null;

    const user = await this.prisma.user.findUnique({ where: { id: claims.user_id } });
    if (!user || !user.isActive) return null;
    // The rule JwtStrategy applies: a token from before the account's sessions
    // were ended cannot open a socket either.
    if ((claims.iat ?? 0) < (await this.sessions.revokedBefore(user.id))) return null;
    // The same lock JwtAuthGuard applies to every HTTP route. The gateway
    // authenticates outside the guard chain, so without this an account still
    // holding its mailed-in-plaintext temporary password could open a socket
    // and subscribe to every collection it has membership for — reading live
    // task, comment and HR traffic through a door the REST API had closed.
    // Such a session may change its password; it may not listen.
    if (user.hasTempPassword) return null;

    const ids = await this.access.accessibleWorkspaceIds(user); // null = admin
    return {
      user,
      workspaceIds: ids === null ? null : new Set(ids),
      expiresAt: claims.exp ? claims.exp * 1000 : undefined,
    };
  }

  /** No Origin is not a browser (a script, a server); one that is there must be ours. */
  private originAllowed(request: IncomingMessage): boolean {
    const header = request.headers?.origin;
    if (!header) return true;
    const origin = String(header).replace(/\/+$/, '').toLowerCase();
    const allowed = String(this.config.get<string>('CORS_ALLOWED_ORIGINS', '') ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
      .filter(Boolean);
    if (allowed.includes(origin)) return true;
    try {
      return new URL(origin).host === String(request.headers?.host ?? '').toLowerCase();
    } catch {
      return false;
    }
  }

  private readCookie(request: IncomingMessage, name: string): string | undefined {
    const header = request.headers?.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key !== name) continue;
      // A malformed escape ("strata_access=%") made decodeURIComponent throw a
      // URIError out of the handshake — and, unawaited by Nest, that rejection
      // took the whole API process down (live-verified). A value that does not
      // decode is simply not a session.
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
