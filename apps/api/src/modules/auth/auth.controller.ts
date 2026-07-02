import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { THROTTLE } from '../../throttling/throttle.constants';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangePasswordDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RegisterDto,
  UpdateProfileDto,
} from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private refreshCookie(req: Request): string | undefined {
    const name = this.config.get<string>('JWT_REFRESH_COOKIE_NAME', 'lt_refresh');
    return req.cookies?.[name] as string | undefined;
  }

  @Public()
  @Throttle({ default: THROTTLE.login })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, sessionId, tokens } = await this.auth.login(dto.email, dto.password);
    this.auth.cookies.setAuth(res, tokens.access, tokens.refresh);
    return { user, sessionId };
  }

  @Public()
  @Throttle({ default: THROTTLE.register })
  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, sessionId, tokens } = await this.auth.register(dto);
    this.auth.cookies.setAuth(res, tokens.access, tokens.refresh);
    return { user, sessionId };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.refreshCookie(req));
    this.auth.cookies.clearAuth(res);
  }

  @Public()
  @Throttle({ default: THROTTLE.refresh })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(this.refreshCookie(req));
    if ('softError' in result) {
      res.status(result.softError.status);
      return { message: result.softError.message };
    }
    this.auth.cookies.setAuth(res, result.tokens.access, result.tokens.refresh);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return this.auth.me(user);
  }

  @Post('change-password')
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
    return result;
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  @Public()
  @Throttle({ default: THROTTLE.reset })
  @Post('password-reset')
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset/confirm')
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
