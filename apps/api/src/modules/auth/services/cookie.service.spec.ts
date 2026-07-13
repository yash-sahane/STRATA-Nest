import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CookieService } from './cookie.service';

function fakeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    JWT_ACCESS_COOKIE_NAME: 'strata_access',
    JWT_REFRESH_COOKIE_NAME: 'strata_refresh',
    JWT_COOKIE_SAMESITE: 'Lax',
    JWT_COOKIE_SECURE: false,
    JWT_COOKIE_DOMAIN: '',
    JWT_ACCESS_TTL: 900,
    JWT_REFRESH_TTL: 604800,
    ...overrides,
  };
  return { get: (k: string, d?: unknown) => (k in values ? values[k] : d) } as unknown as ConfigService;
}

interface Rec {
  name: string;
  value: string;
  opts: Record<string, unknown>;
}
function fakeRes() {
  const set: Rec[] = [];
  const cleared: { name: string; opts: Record<string, unknown> }[] = [];
  const res = {
    cookie: (name: string, value: string, opts: Record<string, unknown>) =>
      set.push({ name, value, opts }),
    clearCookie: (name: string, opts: Record<string, unknown>) => cleared.push({ name, opts }),
  } as unknown as Response;
  return { res, set, cleared };
}

describe('CookieService — cookie attribute contract', () => {
  it('sets both auth cookies with the exact attributes', () => {
    const svc = new CookieService(fakeConfig());
    const { res, set } = fakeRes();
    svc.setAuth(res, 'ACCESS', 'REFRESH');

    const access = set.find((c) => c.name === 'strata_access')!;
    const refresh = set.find((c) => c.name === 'strata_refresh')!;
    expect(access.value).toBe('ACCESS');
    expect(refresh.value).toBe('REFRESH');
    expect(access.opts).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 900_000, // 900s → ms; Set-Cookie Max-Age serializes back to 900s
    });
    expect(refresh.opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 604_800_000 });
    expect(access.opts.domain).toBeUndefined();
  });

  it('honors Secure + SameSite=None from config (prod cross-site)', () => {
    const svc = new CookieService(fakeConfig({ JWT_COOKIE_SECURE: true, JWT_COOKIE_SAMESITE: 'None' }));
    const { res, set } = fakeRes();
    svc.setAuth(res, 'A', 'R');
    expect(set[0].opts).toMatchObject({ secure: true, sameSite: 'none' });
  });

  it('clears both cookies with Path=/ on logout', () => {
    const svc = new CookieService(fakeConfig());
    const { res, cleared } = fakeRes();
    svc.clearAuth(res);
    expect(cleared.map((c) => c.name).sort()).toEqual(['strata_access', 'strata_refresh']);
    expect(cleared[0].opts).toMatchObject({ path: '/' });
  });
});
