import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/redis.constants';

/**
 * Redis allowlist of active refresh-token `jti`s per user.
 * This is what makes refresh tokens REVOCABLE: rotation stores a
 * new jti and revokes the old one; logout revokes it.
 */
@Injectable()
export class RefreshTokenStore {
  private readonly ttl: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.ttl = config.get<number>('JWT_REFRESH_TTL', 604800);
  }

  private key(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  /**
   * Tombstone for a jti that has been explicitly revoked.
   *
   * `isActive` cannot tell "revoked" from "never tracked" — both are a missing
   * key — which is why the allowlist check is gated behind AUTH_STRICT_REFRESH.
   * With that flag off (the default) logout was cosmetic: a copy of the refresh
   * cookie taken beforehand still minted new 7-day sessions. A positive
   * denylist can be consulted unconditionally without breaking compatibility
   * mode, because a token that was never tracked is also never tombstoned.
   */
  private revokedKey(userId: string, jti: string): string {
    return `refresh:revoked:${userId}:${jti}`;
  }

  async store(userId: string, jti: string): Promise<void> {
    await this.redis.set(this.key(userId, jti), '1', 'EX', this.ttl);
  }

  async isActive(userId: string, jti: string): Promise<boolean> {
    return (await this.redis.exists(this.key(userId, jti))) === 1;
  }

  async revoke(userId: string, jti: string): Promise<void> {
    await this.redis.del(this.key(userId, jti));
    // Outlive the token itself: the tombstone must still be there for as long
    // as the signature would otherwise be accepted.
    await this.redis.set(this.revokedKey(userId, jti), '1', 'EX', this.ttl);
  }

  /** Whether this jti was explicitly revoked (logout, or rotation replay). */
  async isRevoked(userId: string, jti: string): Promise<boolean> {
    return (await this.redis.exists(this.revokedKey(userId, jti))) === 1;
  }

  /** Revoke every refresh token for a user ("log out everywhere"). */
  async revokeAll(userId: string): Promise<void> {
    const keys = await this.redis.keys(`refresh:${userId}:*`);
    const live = keys.filter((k) => !k.startsWith(`refresh:revoked:`));
    for (const k of live) {
      const jti = k.slice(`refresh:${userId}:`.length);
      await this.redis.set(this.revokedKey(userId, jti), '1', 'EX', this.ttl);
    }
    if (live.length) await this.redis.del(...live);
  }
}
