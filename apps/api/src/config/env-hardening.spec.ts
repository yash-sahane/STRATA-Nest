import { validateEnv } from '@strata/config';

/** Minimal valid non-prod env. */
const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'short',
  JWT_REFRESH_SECRET: 'short',
};

const strong = 'a'.repeat(32);
const prodOk = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/db',
  JWT_ACCESS_SECRET: strong,
  JWT_REFRESH_SECRET: strong,
  INTEGRATION_TOKEN_ENC_KEY: strong,
  JWT_COOKIE_SECURE: 'true',
};

describe('validateEnv — production hard gates', () => {
  it('accepts short dev secrets in non-production', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('accepts a fully-hardened production env', () => {
    expect(() => validateEnv(prodOk)).not.toThrow();
  });

  it('rejects weak JWT signing keys in production', () => {
    expect(() => validateEnv({ ...prodOk, JWT_ACCESS_SECRET: 'tooshort' })).toThrow(
      /JWT_ACCESS_SECRET must be ≥ 32/,
    );
  });

  it('rejects a missing token-encryption key in production', () => {
    const env = { ...prodOk } as Record<string, unknown>;
    delete env.INTEGRATION_TOKEN_ENC_KEY;
    expect(() => validateEnv(env)).toThrow(/INTEGRATION_TOKEN_ENC_KEY must be ≥ 32/);
  });

  it('rejects non-Secure auth cookies in production', () => {
    expect(() => validateEnv({ ...prodOk, JWT_COOKIE_SECURE: 'false' })).toThrow(
      /JWT_COOKIE_SECURE must be true/,
    );
  });

  it('parses boolean flags correctly ("false" is false, not truthy)', () => {
    // Guards the z.coerce.boolean footgun where "false" → true.
    expect(validateEnv({ ...base, RBAC_ENFORCED: 'false' }).RBAC_ENFORCED).toBe(false);
    expect(validateEnv({ ...base, RBAC_ENFORCED: '0' }).RBAC_ENFORCED).toBe(false);
    expect(validateEnv({ ...base, RBAC_ENFORCED: 'true' }).RBAC_ENFORCED).toBe(true);
    expect(validateEnv({ ...base, RBAC_ENFORCED: '1' }).RBAC_ENFORCED).toBe(true);
    expect(validateEnv(base).RBAC_ENFORCED).toBe(true); // secure default
  });
});
