import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@lt/prisma';
import type { JwtClaims } from '../services/token.service';

/** Reads the access JWT from the `lt_access` cookie (replaces Django's
 *  JWTCookieAuthentication/middleware — M§7). */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const cookieName = config.get<string>('JWT_ACCESS_COOKIE_NAME', 'lt_access');
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
    return user;
  }
}
