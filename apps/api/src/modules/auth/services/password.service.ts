import { Injectable } from '@nestjs/common';
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

/**
 * PBKDF2-SHA256 password hashing — the application's permanent password format.
 *
 * Encoded format:
 *   pbkdf2_sha256$<iterations>$<salt>$<base64(dk)>
 *
 * - `verify` reads the iterations+salt embedded in the stored hash, so it accepts
 *   hashes written with any historical iteration count.
 * - `hash` always writes the current format.
 *
 * Asynchronous on purpose. 600,000 rounds take ~90 ms of CPU, and `pbkdf2Sync`
 * spent them ON the event loop: every sign-in, password change, reset and
 * account creation froze the whole API — every other request, every socket —
 * for that long, and a handful of sign-ins at once (or a password-guessing
 * script working within the rate limit) queued everybody behind them. The async
 * form runs the rounds on libuv's thread pool and the loop keeps serving.
 */
@Injectable()
export class PasswordService {
  private static readonly ALGO = 'pbkdf2_sha256';
  private static readonly ITERATIONS = 600_000;
  private static readonly KEYLEN = 32;
  private static readonly SALT_LEN = 16;
  private static readonly ALPHABET =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  /** A well-formed hash at today's cost that no password is checked against for real. */
  private static readonly DECOY = `${PasswordService.ALGO}$${PasswordService.ITERATIONS}$decoydecoydecoy0$${'A'.repeat(43)}=`;

  async hash(
    password: string,
    iterations: number = PasswordService.ITERATIONS,
    salt: string = this.randomSalt(),
  ): Promise<string> {
    const dk = (
      await pbkdf2Async(password, salt, iterations, PasswordService.KEYLEN, 'sha256')
    ).toString('base64');
    return `${PasswordService.ALGO}$${iterations}$${salt}$${dk}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 4 || parts[0] !== PasswordService.ALGO) return false;
    const iterations = Number.parseInt(parts[1], 10);
    const salt = parts[2];
    const expected = parts[3];
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const actual = (
      await pbkdf2Async(password, salt, iterations, PasswordService.KEYLEN, 'sha256')
    ).toString('base64');
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Spend what `verify` spends, and match nothing.
   *
   * Signing in as an address with no account answered at once, while a real one
   * first paid for 600,000 rounds of PBKDF2 — so the response time said which
   * addresses have accounts, whatever the message said. Checking the password
   * against a decoy makes the two cost the same.
   */
  async verifyDecoy(password: string): Promise<false> {
    await this.verify(password, PasswordService.DECOY);
    return false;
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
