import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { User } from '@prisma/client';
import { ALLOW_TEMP_PASSWORD_KEY } from '../decorators/allow-temp-password.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Global guard: authenticates every route via the cookie JWT strategy, except
 *  those marked @Public(). Registered as APP_GUARD in AppModule. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    // "You must change your temporary password to continue" was enforced only
    // by the client's post-login redirect, so typing any URL walked straight
    // past it: the account went on reading — and writing, PATCH /auth/profile
    // returned 200 — while still authenticating with a password that had been
    // mailed in plaintext. The force belongs here, where no navigation can
    // route around it. Such a session may read itself, replace the password
    // and log out; nothing else, until it does.
    const { user } = context.switchToHttp().getRequest<{ user?: User }>();
    if (!user?.hasTempPassword) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_TEMP_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw new ForbiddenException({
      message: 'Change your temporary password before continuing.',
      type: 'PasswordChangeRequired',
    });
  }
}
