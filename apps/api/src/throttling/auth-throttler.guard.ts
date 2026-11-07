import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIP } from 'node:net';
import { TrustedProxies } from './trusted-proxies';

/**
 * Rate-limit tracker: by client address for login/refresh; by **address +
 * e-mail** for the password-reset request (per the security checklist). Keys
 * are namespaced by route automatically, so per-route @Throttle limits are
 * independent.
 *
 * WHICH address matters. This used to take the first entry of X-Forwarded-For,
 * and nginx APPENDS to whatever the caller sent — so the first entry was the
 * caller's own invention, and a fresh value on every request gave every request
 * a fresh bucket: the five-a-minute login limit never filled.
 *
 * The address is now the one the nearest proxy vouches for (X-Real-IP, which
 * nginx overwrites, else the last X-Forwarded-For hop it appended), and those
 * headers are believed only when the connection itself comes from a proxy named
 * in TRUSTED_PROXIES (see TrustedProxies — "any private address" was not a
 * proxy often enough). A caller reaching the API directly is keyed on its
 * socket address and cannot talk its way into another bucket.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = clientAddress(req);
    const url = String((req.originalUrl as string) || (req.url as string) || '');
    if (url.includes('/auth/password-reset') && !url.includes('/confirm')) {
      const body = (req.body as { email?: unknown }) ?? {};
      // Trimmed as well as lower-cased: this runs before the DTO normalises the
      // field, so " a@x.com" and "a@x.com " each had a bucket of their own.
      const email = String(body.email ?? '').trim().toLowerCase();
      return `${ip}:${email}`;
    }
    return ip;
  }

}

/**
 * Who may vouch for a caller's address. Read once, at import — as the limits in
 * throttle.constants are, and for the same reason (main.ts loads .env first).
 */
const TRUSTED_PROXIES = new TrustedProxies(process.env.TRUSTED_PROXIES ?? 'loopback');

/**
 * The caller's address: the socket's own, or — only when the connection comes
 * from a trusted proxy — the one that proxy vouches for.
 */
export function clientAddress(
  req: Record<string, unknown>,
  trusted: TrustedProxies = TRUSTED_PROXIES,
): string {
  const socket = req.socket as { remoteAddress?: string } | undefined;
  const peer = (req.ip as string) || socket?.remoteAddress || 'unknown';
  if (!trusted.has(peer)) return peer;
  const headers = (req.headers as Record<string, string | string[] | undefined>) ?? {};
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[value.length - 1] : value) ?? '';
  // Only an actual address: anything else would be a bucket of its own.
  const realIp = one(headers['x-real-ip']).trim();
  if (isIP(realIp)) return realIp;
  const lastHop = one(headers['x-forwarded-for']).split(',').pop()?.trim() ?? '';
  return isIP(lastHop) ? lastHop : peer;
}
