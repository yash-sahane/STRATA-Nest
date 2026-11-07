import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

/** Two keys, as a real configuration has: one per kind of token. */
function fakeConfig(access = 'test-access-secret', refresh = 'test-refresh-secret'): ConfigService {
  return {
    getOrThrow: (key: string) => (key === 'JWT_REFRESH_SECRET' ? refresh : access),
    get: (key: string, def?: unknown) =>
      key === 'JWT_ACCESS_TTL' ? 900 : key === 'JWT_REFRESH_TTL' ? 604800 : def,
  } as unknown as ConfigService;
}

describe('TokenService — frozen claim layout', () => {
  const svc = new TokenService(new JwtService({}), fakeConfig());

  it('signs an access token with user_id / token_type / jti and verifies it', () => {
    const token = svc.signAccess('user-1');
    const claims = svc.verify(token);
    expect(claims.user_id).toBe('user-1');
    expect(claims.token_type).toBe('access');
    expect(claims.jti).toEqual(expect.any(String));
    expect(claims.exp).toBeGreaterThan(claims.iat as number);
  });

  it('signs a refresh token and returns its jti', () => {
    const { token, jti } = svc.signRefresh('user-2');
    const claims = svc.verifyRefresh(token);
    expect(claims.token_type).toBe('refresh');
    expect(claims.jti).toBe(jti);
    expect(claims.user_id).toBe('user-2');
  });

  it('rejects a token signed with a different key', () => {
    const other = new TokenService(new JwtService({}), fakeConfig('different-secret'));
    const foreign = other.signAccess('user-3');
    expect(() => svc.verify(foreign)).toThrow();
  });
});

/**
 * JWT_REFRESH_SECRET has always been required — the process will not start
 * without a strong one — and was never read: both kinds of token were signed
 * with the access key, so whoever held that one key could mint a refresh token
 * and keep a session alive for good.
 */
describe('TokenService — one key per kind of token', () => {
  const svc = new TokenService(new JwtService({}), fakeConfig());

  it('a refresh token is not an access token, by signature and not only by its claim', () => {
    const { token } = svc.signRefresh('user-1');
    expect(() => svc.verify(token)).toThrow();
  });

  it('an access token cannot be presented as a refresh token', () => {
    expect(() => svc.verifyRefresh(svc.signAccess('user-1'))).toThrow();
  });

  it('holding the access key alone is not enough to mint a refresh token', () => {
    // Somebody who has the access key and nothing else: they sign with it.
    const forger = new TokenService(
      new JwtService({}),
      fakeConfig('test-access-secret', 'test-access-secret'),
    );
    const { token } = forger.signRefresh('victim');
    expect(() => svc.verifyRefresh(token)).toThrow();
  });
});
