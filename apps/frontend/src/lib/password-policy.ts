/**
 * The password rules this app displays — and the server enforces.
 *
 * The change-password screen used to hardcode four requirements with live green
 * ticks while the API enforced only `MinLength(8)`, so `aaaaaaaa` was accepted
 * with three of the four ticks still grey. A checklist that is not a contract is
 * worse than no checklist: it teaches the user a rule and then ignores it.
 *
 * This list mirrors `PASSWORD_RULES` in
 * `packages/common/src/validation/password-policy.ts`, which the `StrongPassword`
 * decorator on every password-setting DTO is built from. The frontend does not
 * depend on `@strata/common` (and should not pull class-validator into the client
 * bundle), so the two are kept in step by
 * `packages/contract-tests/src/contract/password-policy.contract.spec.ts`, which
 * asks the live API to reject a candidate failing each rule in turn.
 */
export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'upper', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { id: 'digit', label: 'One number', test: (v) => /[0-9]/.test(v) },
];

/** Which rules a candidate fails, by label. Empty means it is acceptable. */
export function passwordFailures(value: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(value)).map((r) => r.label);
}

export function isStrongPassword(value: string): boolean {
  return passwordFailures(value).length === 0;
}
