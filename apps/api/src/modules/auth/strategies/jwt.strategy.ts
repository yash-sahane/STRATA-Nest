import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@strata/prisma';
import type { JwtClaims } from '../services/token.service';
import { RefreshTokenStore } from '../services/refresh-token.store';

/** Reads the access JWT from the `strata_access` cookie. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: RefreshTokenStore,
  ) {
    const cookieName = config.get<string>('JWT_ACCESS_COOKIE_NAME', 'strata_access');
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies?.[cookieName] as string | undefined) ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtClaims) {
    if (payload.token_type !== 'access') throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: payload.user_id } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    // Issued before the account's sessions were ended (password reset or change,
    // a new temporary password, deactivation): no longer a session.
    if ((payload.iat ?? 0) < (await this.sessions.revokedBefore(user.id))) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
