import { Injectable } from '@nestjs/common';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * PBKDF2-SHA256 password hashing — the application's permanent password format.
 *
 * Encoded format:
 *   pbkdf2_sha256$<iterations>$<salt>$<base64(dk)>
 *
 * - `verify` reads the iterations+salt embedded in the stored hash, so it accepts
 *   hashes written with any historical iteration count.
 * - `hash` always writes the current format.
 */
@Injectable()
export class PasswordService {
  private static readonly ALGO = 'pbkdf2_sha256';
  private static readonly ITERATIONS = 600_000;
  private static readonly KEYLEN = 32;
  private static readonly SALT_LEN = 16;
  private static readonly ALPHABET =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  hash(
    password: string,
    iterations: number = PasswordService.ITERATIONS,
    salt: string = this.randomSalt(),
  ): string {
    const dk = pbkdf2Sync(password, salt, iterations, PasswordService.KEYLEN, 'sha256').toString(
      'base64',
    );
    return `${PasswordService.ALGO}$${iterations}$${salt}$${dk}`;
  }

  verify(password: string, encoded: string): boolean {
    const parts = encoded.split('$');
    if (parts.length !== 4 || parts[0] !== PasswordService.ALGO) return false;
    const iterations = Number.parseInt(parts[1], 10);
    const salt = parts[2];
    const expected = parts[3];
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const actual = pbkdf2Sync(password, salt, iterations, PasswordService.KEYLEN, 'sha256').toString(
      'base64',
    );
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** True if the stored hash should be upgraded (wrong algo or too-few iterations). */
  needsRehash(encoded: string): boolean {
    const parts = encoded.split('$');
    return (
      parts[0] !== PasswordService.ALGO ||
      Number.parseInt(parts[1] ?? '0', 10) < PasswordService.ITERATIONS
    );
  }

  private randomSalt(): string {
    const bytes = randomBytes(PasswordService.SALT_LEN);
    let out = '';
    for (let i = 0; i < PasswordService.SALT_LEN; i += 1) {
      out += PasswordService.ALPHABET[bytes[i] % PasswordService.ALPHABET.length];
    }
    return out;
  }
}
