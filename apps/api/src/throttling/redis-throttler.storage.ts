import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Distributed rate-limit storage backed by Redis, so
 * limits are shared across API replicas (horizontal scaling). One atomic Lua
 * script does INCR + PEXPIRE + block accounting per request (no read-modify-write
 * race). Fail-open: if Redis is unreachable the request is allowed and a warning
 * is logged — a rate-limiter outage must not take the API down.
 *
 * Interface (@nestjs/throttler v6): ttl/blockDuration are milliseconds;
 * timeToExpire/timeToBlockExpire are returned in seconds.
 */
const LUA = `
local blockPttl = redis.call('PTTL', KEYS[2])
if blockPttl > 0 then
  local curHits = tonumber(redis.call('GET', KEYS[1]) or '0')
  local curPttl = redis.call('PTTL', KEYS[1])
  if curPttl < 0 then curPttl = 0 end
  return {curHits, curPttl, 1, blockPttl}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then pttl = 0 end
local blocked = 0
local bttl = 0
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = 1
  bttl = tonumber(ARGV[3])
end
return {hits, pttl, blocked, bttl}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('Throttler');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const counter = `throttle:${throttlerName}:${key}`;
    const block = `throttle:block:${throttlerName}:${key}`;
    const blockMs = blockDuration > 0 ? blockDuration : ttl;
    try {
      const [hits, pttl, blocked, bttl] = (await this.redis.eval(
        LUA,
        2,
        counter,
        block,
        String(ttl),
        String(limit),
        String(blockMs),
      )) as [number, number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(pttl / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(bttl / 1000),
      };
    } catch (err) {
      // Fail-open: availability over strict limiting during a Redis blip.
      this.logger.warn(`redis throttler unavailable, allowing request: ${(err as Error).message}`);
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
