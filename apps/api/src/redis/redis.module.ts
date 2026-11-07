import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisConnection } from '@strata/config';
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
          ...redisConnection((key) => config.get(key), 'cache'),
          maxRetriesPerRequest: 2,
          // A bound on every command, the queued ones included (ioredis arms it
          // before deciding whether to queue). Without it a command issued while
          // Redis was unreachable sat in the offline queue through every
          // reconnect attempt — each up to connectTimeout — and EVERY request
          // behind the throttler and the session check hung with it (measured:
          // /health and /auth/me unanswered after 15s with Redis stopped). The
          // throttler already fails open on an error; this is what lets one
          // arrive. Nothing here runs anywhere near this long when Redis is up.
          commandTimeout: 2000,
        }),
    },
    RedisLifecycleService,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
