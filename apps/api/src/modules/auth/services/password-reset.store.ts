import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { REDIS_CLIENT } from '../../../redis/redis.constants';

/**
 * Single-use password-reset tokens in Redis.
 * The response contract is constant-time — always {ok:true}, never revealing
 * whether the email exists.
 */
@Injectable()
export class PasswordResetStore {
  private static readonly TTL = 60 * 60; // 1 hour

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(userId: string): string {
    return `pwreset:${userId}`;
  }

  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(this.key(userId), token, 'EX', PasswordResetStore.TTL);
    return token;
  }

  async consume(userId: string, token: string): Promise<boolean> {
    const stored = await this.redis.get(this.key(userId));
    if (!stored || stored !== token) return false;
    await this.redis.del(this.key(userId));
    return true;
  }
}
