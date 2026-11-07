export * from './env.schema';
export * from './business-day';
export * from './workspace-settings';

import type { Env } from './env.schema';

/** Redis's two logical databases: the cache (sessions, realtime fan-out) and BullMQ's queues. */
export type RedisDatabase = 'cache' | 'queue';

/**
 * Where Redis is, for one of its databases — the options every ioredis client
 * and BullMQ queue or worker starts from, adding only its own (retries, lazy
 * connect). `read` is the app's config lookup, e.g. `(key) => config.get(key)`.
 */
export function redisConnection(
  read: (key: string) => unknown,
  database: RedisDatabase,
): { host: string; port: number; db: number } {
  const value = (key: string, fallback: string | number) => read(key) ?? fallback;
  return {
    host: String(value('REDIS_HOST', 'localhost')),
    port: Number(value('REDIS_PORT', 6379)),
    db: Number(database === 'cache' ? value('REDIS_CACHE_DB', 0) : value('REDIS_QUEUE_DB', 1)),
  };
}

/** Parse the comma-separated CORS origins into an array. */
export function corsOrigins(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
