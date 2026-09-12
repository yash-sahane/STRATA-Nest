import { BASE, call, isReachable } from '../support/api-contract';

/**
 * The password checklist the UI draws has to be the policy the API enforces.
 *
 * It was not: the change-password screen listed four requirements with live
 * green ticks — 8 characters, an uppercase letter, a lowercase letter, a number
 * — and the API enforced `MinLength(8)` alone, so `aaaaaaaa` was accepted with
 * three of the four ticks still grey.
 *
 * The rules now live in one place, `PASSWORD_RULES` in
 * `packages/common/src/validation/password-policy.ts`, and the frontend mirrors
 * them in `apps/frontend/src/lib/password-policy.ts` because it does not depend
 * on `@strata/common`. This spec is what stops the two drifting.
 *
 * It probes `/auth/password-reset/confirm/`, deliberately, not `/auth/register/`:
 * validation runs on the DTO before the uid/token is looked at, so a bogus token
 * is enough to reach the policy — and register is throttled to 3 per hour, which
 * would make the fourth case fail as a 429 and the suite unrunnable twice.
 */
const post = (path: string, body: unknown) =>
  call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const CONFIRM = '/api/v1/auth/password-reset/confirm/';

/** Each candidate fails exactly one listed rule and satisfies the other three. */
const CANDIDATES: Array<{ rule: string; password: string }> = [
  { rule: 'at least 8 characters', password: 'Ab3defg' },
  { rule: 'one uppercase letter', password: 'ab3defgh' },
  { rule: 'one lowercase letter', password: 'AB3DEFGH' },
  { rule: 'one number', password: 'AbcdefgH' },
];

/** Satisfies every listed rule — the control. */
const ACCEPTABLE = 'Abcdefg3';

describe('Contract — the password policy the UI advertises is the one enforced', () => {
  let available = false;
  beforeAll(async () => {
    available = await isReachable();
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn(`[contract] ${BASE} unreachable — password-policy checks are no-ops.`);
    }
  });

  it.each(CANDIDATES)('a password missing "$rule" is refused', async ({ password }) => {
    if (!available) return;
    const { status, body } = await post(CONFIRM, {
      uid: 'contract-not-a-real-uid',
      token: 'contract-not-a-real-token',
      newPassword: password,
    });
    expect(status).toBe(400);
    // The message names what was missing, so somebody fixing one rule at a time
    // does not need four round trips to learn all four.
    expect(JSON.stringify(body)).toMatch(/Password must have/i);
  });

  it('a candidate satisfying every listed rule is not refused BY THE POLICY', async () => {
    if (!available) return;
    // The bogus token still fails, and that is expected. What must not happen is
    // a complaint about the policy: that would mean the list above is stricter
    // than the real rules and every assertion here passed for the wrong reason.
    const { status, body } = await post(CONFIRM, {
      uid: 'contract-not-a-real-uid',
      token: 'contract-not-a-real-token',
      newPassword: ACCEPTABLE,
    });
    const text = JSON.stringify(body ?? {});
    expect({ policyComplaint: /Password must have/i.test(text) }).toEqual({
      policyComplaint: false,
    });
    // It failed for the token, not the password.
    expect(status).toBeGreaterThanOrEqual(400);
  });
});
