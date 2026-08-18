import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

function fakeConfig(secret = 'test-secret'): ConfigService {
  return {
    getOrThrow: () => secret,
    get: (key: string, def?: unknown) =>
      key === 'JWT_ACCESS_TTL' ? 900 : key === 'JWT_REFRESH_TTL' ? 604800 : def,
  } as unknown as ConfigService;
}

describe('TokenService — SimpleJWT-compatible claims', () => {
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
    const claims = svc.verify(token);
    expect(claims.token_type).toBe('refresh');
    expect(claims.jti).toBe(jti);
    expect(claims.user_id).toBe('user-2');
  });

  it('rejects a token signed with a different key (dual-run relies on a shared key)', () => {
    const other = new TokenService(new JwtService({}), fakeConfig('different-secret'));
    const foreign = other.signAccess('user-3');
    expect(() => svc.verify(foreign)).toThrow();
  });
});
