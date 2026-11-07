import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/redis.constants';

/** How many times the per-address limit the account takes from everywhere at once. */
const ACCOUNT_CEILING = 5;

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Failed sign-ins, counted per ACCOUNT and per ADDRESS trying it.
 *
 * The request throttle counts per address: five a minute from one IP. That stops
 * one machine guessing quickly and does nothing about many machines guessing
 * slowly. Counting by the account alone closed that, and opened another door:
 * anybody who knew a colleague's address — the directory shows it to every
 * member — could lock that colleague out, every fifteen minutes, for as long as
 * they cared to, and resetting the password did not lift it.
 *
 * So each (account, address) pair gets AUTH_LOCKOUT_ATTEMPTS failures inside
 * AUTH_LOCKOUT_WINDOW seconds; somebody guessing from one place locks out only
 * that place. And the account as a whole takes ACCOUNT_CEILING times that from
 * everywhere together, which is what a spread-out attack runs into. Setting a
 * new password (reset, change, a re-issued temporary one) clears it all.
 *
 * It is a pause, not a lock: nobody has to be asked to undo it, and a correct
 * sign-in clears the count. Addresses are stored as digests — this is a list of
 * the accounts somebody is attacking. Counted the same for an address that has
 * no account, so the answer cannot be used to learn which addresses do.
 */
@Injectable()
export class LoginAttemptStore {
  private readonly logger = new Logger('LoginAttempts');
  private readonly limit: number;
  private readonly windowSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.limit = config.get<number>('AUTH_LOCKOUT_ATTEMPTS', 10);
    this.windowSeconds = config.get<number>('AUTH_LOCKOUT_WINDOW', 900);
  }

  private key(email: string): string {
    return `login:failed:${digest(email)}`;
  }

  private field(address: string): string {
    return `from:${digest(address)}`;
  }

  /**
   * Seconds until this account may be tried again from this address; 0 when
   * it may be now. A store that cannot be reached pauses nobody — Redis being
   * down must not be what stops people signing in.
   *
   * `accountWide: false` asks about this address's own count alone. For a check
   * made by somebody already signed in (change-password): a stranger guessing at
   * the sign-in page must not be able to lock the owner out of their settings.
   */
  async lockedFor(
    email: string,
    address: string,
    opts: { accountWide?: boolean } = {},
  ): Promise<number> {
    if (this.limit <= 0) return 0;
    try {
      const [fromHere, everywhere] = await this.redis.hmget(this.key(email), this.field(address), 'all');
      const locked =
        Number(fromHere ?? 0) >= this.limit ||
        (opts.accountWide !== false && Number(everywhere ?? 0) >= this.limit * ACCOUNT_CEILING);
      if (!locked) return 0;
      const remaining = await this.redis.ttl(this.key(email));
      return remaining > 0 ? remaining : 0;
    } catch (err) {
      this.logger.warn(`attempt store unavailable, allowing sign-in: ${(err as Error).message}`);
      return 0;
    }
  }

  async recordFailure(email: string, address: string): Promise<void> {
    if (this.limit <= 0) return;
    try {
      const key = this.key(email);
      await this.redis.hincrby(key, this.field(address), 1);
      await this.redis.hincrby(key, 'all', 1);
      // The window starts at the account's FIRST failure and is not pushed back
      // by later ones, so the pause always ends when it said it would.
      if ((await this.redis.ttl(key)) < 0) await this.redis.expire(key, this.windowSeconds);
    } catch (err) {
      this.logger.warn(`failed sign-in not counted: ${(err as Error).message}`);
    }
  }

  /** Forget every failure against this account: it signed in, or has a new password. */
  async clear(email: string): Promise<void> {
    try {
      await this.redis.del(this.key(email));
    } catch {
      /* nothing to clear from a store that is not there */
    }
  }
}
