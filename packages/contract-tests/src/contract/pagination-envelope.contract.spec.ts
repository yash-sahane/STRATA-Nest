import { COOKIE, call } from '../support/api-contract';

/**
 * Locks the versioned pagination envelope:
 *   { items: [...], total, page, pageSize }
 *
 * Requires an authenticated session, so it is opt-in: set CONTRACT_COOKIE to a
 * valid "strata_access=<jwt>" string to enable. Without it the test is skipped.
 */
const authed = COOKIE ? it : it.skip;

describe('Contract — pagination envelope', () => {
  authed('list endpoints return { items, total, page, pageSize }', async () => {
    const { status, body } = await call('/api/v1/projects/?pageSize=1');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      items: expect.any(Array),
      total: expect.any(Number),
      page: expect.any(Number),
      pageSize: expect.any(Number),
    });
  });
});
