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
 * `jti` — snake_case is intentional, not an oversight) and a single signing key
 * shared by access and refresh tokens. This layout is part of the
 * public auth contract; do not refactor the field names.
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
        secret: this.signingKey(),
        algorithm: 'HS256',
        expiresIn: this.config.get<number>('JWT_REFRESH_TTL', 604800),
      },
    );
    return { token, jti };
  }

  verify(token: string): JwtClaims {
    return this.jwt.verify<JwtClaims>(token, {
      secret: this.signingKey(),
      algorithms: ['HS256'],
    });
  }
}
