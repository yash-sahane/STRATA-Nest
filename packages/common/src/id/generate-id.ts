import { randomInt } from 'node:crypto';

/**
 * Native resource ID generator — byte-compatible with the Django implementation
 * `apps/core/models.generate_native_id` (CURRENT_SYSTEM_AUDIT.md §4.1; ADR-0002).
 *
 * Django: `"".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(20))`
 *   - alphabet = a-z + A-Z + 0-9  (62 symbols, lowercase then uppercase then digits)
 *   - length   = 20
 *   - selection = cryptographically secure, uniform
 *
 * Parity matters because these IDs are stored as soft-FK strings across tables
 * and used as frontend cache keys; a different scheme would break existing data
 * (ADR-0002). `randomInt` is CSPRNG-backed and unbiased over [0, max).
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
