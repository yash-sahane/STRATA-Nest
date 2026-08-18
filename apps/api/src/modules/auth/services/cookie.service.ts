import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';

/** Sets/clears the JWT cookies with the exact Django attributes (A§5.3, §5). */
@Injectable()
export class CookieService {
  constructor(private readonly config: ConfigService) {}

  private accessName(): string {
    return this.config.get<string>('JWT_ACCESS_COOKIE_NAME', 'lt_access');
  }
  private refreshName(): string {
    return this.config.get<string>('JWT_REFRESH_COOKIE_NAME', 'lt_refresh');
  }

  private base(): CookieOptions {
    const sameSite = this.config
      .get<string>('JWT_COOKIE_SAMESITE', 'Lax')
      .toLowerCase() as 'lax' | 'strict' | 'none';
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('JWT_COOKIE_SECURE', false),
      sameSite,
      domain: this.config.get<string>('JWT_COOKIE_DOMAIN') || undefined,
      path: '/',
    };
  }

  setAuth(res: Response, access: string, refresh: string): void {
    res.cookie(this.accessName(), access, {
      ...this.base(),
      maxAge: this.config.get<number>('JWT_ACCESS_TTL', 900) * 1000,
    });
    res.cookie(this.refreshName(), refresh, {
      ...this.base(),
      maxAge: this.config.get<number>('JWT_REFRESH_TTL', 604800) * 1000,
    });
  }

  clearAuth(res: Response): void {
    const opts: CookieOptions = {
      path: '/',
      domain: this.config.get<string>('JWT_COOKIE_DOMAIN') || undefined,
    };
    res.clearCookie(this.accessName(), opts);
    res.clearCookie(this.refreshName(), opts);
  }
}
