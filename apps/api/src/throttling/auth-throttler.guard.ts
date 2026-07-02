import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit tracker: by client IP for login/refresh/register; by **IP + email**
 * for the password-reset request (per the security checklist). Honors
 * X-Forwarded-For (behind nginx). Keys are namespaced by route automatically,
 * so per-route @Throttle limits are independent.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = this.clientIp(req);
    const url = String((req.originalUrl as string) || (req.url as string) || '');
    if (url.includes('/auth/password-reset') && !url.includes('/confirm')) {
      const body = (req.body as { email?: unknown }) ?? {};
      const email = String(body.email ?? '').toLowerCase();
      return `${ip}:${email}`;
    }
    return ip;
  }

  private clientIp(req: Record<string, unknown>): string {
    const headers = (req.headers as Record<string, string | undefined>) ?? {};
    const xff = headers['x-forwarded-for']?.split(',')[0]?.trim();
    const socket = req.socket as { remoteAddress?: string } | undefined;
    return xff || (req.ip as string) || socket?.remoteAddress || 'unknown';
  }
}
