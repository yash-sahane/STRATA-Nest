import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';

export type TokenType = 'access' | 'refresh';

/** JWT claim set. */
export interface JwtClaims {
  user_id: string;
  token_type: TokenType;
  jti: string;
  iat?: number;
  exp?: number;
}

/**
 * Issues/verifies HS256 tokens with a fixed claim layout (`user_id`, `token_type`,
 * `jti` — snake_case is intentional, not an oversight). This layout is part of
 * the public auth contract; do not refactor the field names.
 *
 * Two keys. JWT_REFRESH_SECRET has always been required — the process will not
 * start without a strong one — and was never read: both kinds of token were
 * signed with the access key, so whoever held that key could mint a refresh
 * token and keep a session alive for good. Refresh tokens are signed and
 * verified with their own key now, which is what the setting was asking for.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private signingKey(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private refreshKey(): string {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  newJti(): string {
    return randomBytes(16).toString('hex');
  }

  signAccess(userId: string, jti: string = this.newJti()): string {
    return this.jwt.sign(
      { user_id: userId, token_type: 'access', jti } satisfies Omit<JwtClaims, 'iat' | 'exp'>,
      {
        secret: this.signingKey(),
        algorithm: 'HS256',
        expiresIn: this.config.get<number>('JWT_ACCESS_TTL', 900),
      },
    );
  }

  signRefresh(userId: string, jti: string = this.newJti()): { token: string; jti: string } {
    const token = this.jwt.sign(
      { user_id: userId, token_type: 'refresh', jti } satisfies Omit<JwtClaims, 'iat' | 'exp'>,
      {
        secret: this.refreshKey(),
        algorithm: 'HS256',
        expiresIn: this.config.get<number>('JWT_REFRESH_TTL', 604800),
      },
    );
    return { token, jti };
  }

  /** An ACCESS token. A refresh token does not verify here: it is another key's. */
  verify(token: string): JwtClaims {
    return this.jwt.verify<JwtClaims>(token, {
      secret: this.signingKey(),
      algorithms: ['HS256'],
    });
  }

  /** A REFRESH token, and only that. */
  verifyRefresh(token: string): JwtClaims {
    return this.jwt.verify<JwtClaims>(token, {
      secret: this.refreshKey(),
      algorithms: ['HS256'],
    });
  }
}
