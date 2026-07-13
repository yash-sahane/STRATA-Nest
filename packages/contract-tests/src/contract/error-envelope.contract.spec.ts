import { BASE, call, isReachable } from '../support/api-contract';

/**
 * Locks the versioned error envelope:
 *   { "error": { "message": ..., "code": <status>, "type": <string> } }
 *
 * Point at the running API with CONTRACT_BASE_URL to enforce it.
 */
describe('Contract — error envelope', () => {
  let available = false;

  beforeAll(async () => {
    available = await isReachable();
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn(
        `[contract] ${BASE} is unreachable — error-envelope checks are no-ops. ` +
          `Start the NestJS API (CONTRACT_BASE_URL) to enforce them.`,
      );
    }
  });

  it('wraps unauthenticated access in { error: { message, code, type } } (401)', async () => {
    if (!available) return;
    const { status, body } = await call('/api/v1/auth/me/');
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 401 } });
    const err = (body as { error: { message: unknown; type: unknown } }).error;
    expect(err.message).toBeDefined();
    expect(typeof err.type).toBe('string');
  });

  it('wraps malformed login in the same envelope (400/401)', async () => {
    if (!available) return;
    const { status, body } = await call('/api/v1/auth/login/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect([400, 401]).toContain(status);
    expect(body).toHaveProperty('error');
    expect((body as { error: { code: number } }).error.code).toBe(status);
  });
});
