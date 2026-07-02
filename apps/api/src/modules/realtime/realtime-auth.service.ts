import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import { PrismaService } from '@lt/prisma';
import type { User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TokenService } from '../auth/services/token.service';

export interface AuthedSocket {
  user: User;
  /** ACTIVE workspace ids, or `null` for platform admin (all). */
  workspaceIds: Set<string> | null;
}

/** Authenticates a WebSocket upgrade using the `lt_access` cookie (A§7 — no `?token=`). */
@Injectable()
export class RealtimeAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async authenticate(request: IncomingMessage): Promise<AuthedSocket | null> {
    const cookieName = this.config.get<string>('JWT_ACCESS_COOKIE_NAME', 'lt_access');
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

    const ids = await this.access.accessibleWorkspaceIds(user); // null = admin
    return { user, workspaceIds: ids === null ? null : new Set(ids) };
  }

  private readCookie(request: IncomingMessage, name: string): string | undefined {
    const header = request.headers?.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  }
}
