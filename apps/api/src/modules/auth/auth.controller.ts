import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { THROTTLE } from '../../throttling/throttle.constants';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { AuthService } from './auth.service';
import { AllowTempPassword } from './decorators/allow-temp-password.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangePasswordDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  UpdateProfileDto,
} from './dto';
import { clientAddress } from '../../throttling/auth-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly access: WorkspaceAccessService,
  ) {}

  private refreshCookie(req: Request): string | undefined {
    const name = this.config.get<string>('JWT_REFRESH_COOKIE_NAME', 'strata_refresh');
    return req.cookies?.[name] as string | undefined;
  }

  @Public()
  @Throttle({ default: THROTTLE.login })
  @Post('login')
  @HttpCode(200) // The frozen API contract requires 200 here, not Nest's POST default 201 (RC live-verified)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, sessionId, tokens } = await this.auth.login(
      dto.email,
      dto.password,
      clientAddress(req as unknown as Record<string, unknown>),
    );
    this.auth.cookies.setAuth(res, tokens.access, tokens.refresh);
    return { user, sessionId };
  }

  // There is deliberately no `register` route. Onboarding is closed: an account
  // exists because a workspace manager created it (POST /users/invite), which is
  // also what the sign-in page tells people. The public endpoint that used to
  // sit here had no screen in front of it, and let anyone on the internet mint
  // an account, read every workspace's name and queue join requests.

  // Reachable on a temporary password: a locked-out session must still be able
  // to read itself, replace the password, and get out.
  //
  // And public, because signing out needs nothing but the refresh cookie it
  // revokes. Behind the access-token guard it answered 401 once that token had
  // lapsed — fifteen minutes — and the client does not retry a logout, so
  // "Log out" did nothing at all for anybody who had been reading a page for a
  // while, and the seven-day refresh cookie stayed live.
  @Public()
  @AllowTempPassword()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.refreshCookie(req));
    this.auth.cookies.clearAuth(res);
  }

  @Public()
  @Throttle({ default: THROTTLE.refresh })
  @Post('refresh')
  @HttpCode(200) // The frozen API contract requires 200 here; softError paths still set their own status below
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(this.refreshCookie(req));
    if ('softError' in result) {
      res.status(result.softError.status);
      return { message: result.softError.message };
    }
    this.auth.cookies.setAuth(res, result.tokens.access, result.tokens.refresh);
    return { ok: true };
  }

  @AllowTempPassword()
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.auth.me(user);
  }

  /**
   * The caller's effective permissions in one workspace.
   *
   * `{ workspaceId, permissions: string[] }`, where `['*']` means a platform
   * admin and `[]` means no active membership. Resolves custom workspace roles
   * the same way every server-side check does, which is the point: the browser
   * was resolving them from a hardcoded map of the seven built-in role names, so
   * a custom role showed no buttons even where the API allowed the action.
   *
   * Deliberately NOT behind @AllowTempPassword: an account that still holds its
   * temporary password has no business enumerating what it could do.
   */
  /**
   * What the caller may do in every workspace they are active in, in one
   * answer — see WorkspaceAccessService.myAccess. The browser resolves every
   * screen permission from this; it used to keep its own copy of the role
   * matrix, and miss the keys the API adds by implication.
   */
  @Get('me/access')
  myAccess(@CurrentUser() user: User) {
    return this.access.myAccess(user);
  }

  @Get('me/permissions')
  async myPermissions(@CurrentUser() user: User, @Query('workspaceId') workspaceId?: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required.');
    }
    const permissions = await this.access.permissions(user, workspaceId);
    return { workspaceId, permissions: [...permissions] };
  }

  @AllowTempPassword()
  @Post('change-password')
  @HttpCode(200) // The frozen API contract requires 200 here; softError paths still set their own status below
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(user, dto);
    if ('softError' in result) {
      res.status(result.softError.status);
      return { message: result.softError.message };
    }
    // Every other session was just signed out; this one carries on under a
    // fresh pair of cookies.
    this.auth.cookies.setAuth(res, result.tokens.access, result.tokens.refresh);
    return { ok: true };
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  @Public()
  @Throttle({ default: THROTTLE.reset })
  @Post('password-reset')
  @HttpCode(200) // The frozen API contract requires 200 here
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200) // The frozen API contract requires 200 here; softError paths still set their own status below
  async confirmPasswordReset(
    @Body() dto: PasswordResetConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.confirmPasswordReset(dto);
    if ('softError' in result) {
      res.status(result.softError.status);
      return { message: result.softError.message };
    }
    return result;
  }
}
