export * from './env.schema';

import type { Env } from './env.schema';

/** Build a redis connection URL for a specific logical DB (ADR-0007). */
export function redisUrl(env: Env, db: number): string {
  return `redis://${env.REDIS_HOST}:${env.REDIS_PORT}/${db}`;
}

/** Connection options object form (ioredis/BullMQ friendly). */
export function redisConnection(env: Env, db: number) {
  return { host: env.REDIS_HOST, port: env.REDIS_PORT, db };
}

/** Parse the comma-separated CORS origins into an array. */
export function corsOrigins(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
