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

  async store(userId: string, jti: string): Promise<void> {
    await this.redis.set(this.key(userId, jti), '1', 'EX', this.ttl);
  }

  async isActive(userId: string, jti: string): Promise<boolean> {
    return (await this.redis.exists(this.key(userId, jti))) === 1;
  }

  async revoke(userId: string, jti: string): Promise<void> {
    await this.redis.del(this.key(userId, jti));
  }

  /** Revoke every refresh token for a user ("log out everywhere"). */
  async revokeAll(userId: string): Promise<void> {
    const keys = await this.redis.keys(`refresh:${userId}:*`);
    if (keys.length) await this.redis.del(...keys);
  }
}
