import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * RC finding: the shared REDIS_CLIENT (a plain useFactory value) had no
 * lifecycle hook, so it was never disconnected on `app.close()` — part of the
 * same graceful-shutdown gap as RealtimeService's subscriber. This wrapper
 * gives the client an OnModuleDestroy hook.
 */
@Injectable()
export class RedisLifecycleService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
