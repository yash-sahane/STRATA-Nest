import { BASE, call, isReachable } from '../support/api-contract';

/**
 * Auth contract checks that need no seeded data (unauthenticated paths).
 * Seeded happy-path flows (login → me → refresh → logout, refresh-reuse rejection)
 * run in the e2e suite against a database.
 */
describe('Contract — auth (unauthenticated behaviors)', () => {
  let available = false;
  beforeAll(async () => {
    available = await isReachable();
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn(`[contract] ${BASE} unreachable — auth checks are no-ops.`);
    }
  });

  it('refresh without a cookie returns 401 { message: "Missing refresh token" } (plain body)', async () => {
    if (!available) return;
    const { status, body } = await call('/api/v1/auth/refresh/', { method: 'POST' });
    expect(status).toBe(401);
    expect(body).toEqual({ message: 'Missing refresh token' });
  });

  it('login with an empty body returns 400 wrapped in the error envelope', async () => {
    if (!available) return;
    const { status, body } = await call('/api/v1/auth/login/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
    expect((body as { error: { code: number } }).error.code).toBe(400);
  });

  it('me without a session returns 401 in the error envelope', async () => {
    if (!available) return;
    const { status, body } = await call('/api/v1/auth/me/');
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 401 } });
  });
});
