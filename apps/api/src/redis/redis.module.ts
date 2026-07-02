import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/** Shared ioredis client on the cache logical DB (ADR-0007). Used by the
 *  refresh-token store and future cache/rate-limit needs. */
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
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
