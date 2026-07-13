import { randomInt } from 'node:crypto';

/**
 * Native resource ID generator — the application's permanent ID format:
 *   - alphabet = a-z + A-Z + 0-9  (62 symbols, lowercase then uppercase then digits)
 *   - length   = 20
 *   - selection = cryptographically secure, uniform
 *
 * This exact format matters because these IDs are stored as soft-FK strings
 * across tables and used as frontend cache keys; a different scheme would
 * break existing data. `randomInt` is CSPRNG-backed and unbiased
 * over [0, max).
 */
export const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const ID_LENGTH = 20;

export function generateId(length: number = ID_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }
  return out;
}

/** True when `value` is shaped like a native ID (20 chars, [A-Za-z0-9]). */
export function isNativeId(value: unknown): value is string {
  return typeof value === 'string' && value.length === ID_LENGTH && /^[A-Za-z0-9]+$/.test(value);
}
