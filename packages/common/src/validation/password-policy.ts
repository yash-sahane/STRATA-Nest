/**
 * One password policy, shared by every route that sets a password.
 *
 * The change-password screen listed four requirements with live green ticks —
 * at least 8 characters, one uppercase letter, one lowercase letter, one
 * number — and the server enforced only the first of them. `aaaaaaaa` was
 * accepted with three of the four ticks still grey, which makes the checklist
 * decoration rather than a contract.
 *
 * The rules below ARE that checklist, so a screen listing them is telling the
 * truth. Keep the two in step: PASSWORD_RULES is exported for the client to
 * render from, precisely so they cannot drift.
 */
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;

/** The requirements, in the order a UI should list them. */
export const PASSWORD_RULES = [
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (v: string) => v.length >= PASSWORD_MIN_LENGTH },
  { id: 'upper', label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { id: 'digit', label: 'One number', test: (v: string) => /[0-9]/.test(v) },
] as const;

/** Which rules a candidate fails, by label. Empty means it is acceptable. */
export function passwordFailures(value: unknown): string[] {
  if (typeof value !== 'string') return PASSWORD_RULES.map((r) => r.label);
  return PASSWORD_RULES.filter((r) => !r.test(value)).map((r) => r.label);
}

export function isStrongPassword(value: unknown): boolean {
  return passwordFailures(value).length === 0;
}

/**
 * Rejects a password that fails any listed rule, naming every rule it failed
 * rather than only the first — somebody correcting one problem at a time
 * should not have to submit four times to discover all four.
 */
export function StrongPassword(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'strongPassword',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => isStrongPassword(value),
        defaultMessage: (args?: ValidationArguments) =>
          `Password must have: ${passwordFailures(args?.value).join(', ')}.`,
      },
    });
  };
}
