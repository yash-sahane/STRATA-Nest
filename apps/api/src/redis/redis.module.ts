import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisLifecycleService } from './redis-lifecycle.service';

/** Shared ioredis client on the cache logical DB. Used by the
 *  refresh-token store, throttler storage, and future cache needs.
 *  RedisLifecycleService closes it on shutdown for graceful shutdown. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          db: config.get<number>('REDIS_CACHE_DB', 0),
          maxRetriesPerRequest: 2,
        }),
    },
    RedisLifecycleService,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
