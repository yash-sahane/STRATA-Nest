import type Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('maps the Lua result to a ThrottlerStorageRecord (ms→s conversion)', async () => {
    // hits=3, pttl=45000ms, blocked=0, bttl=0
    const eval_ = jest.fn().mockResolvedValue([3, 45000, 0, 0]);
    const storage = new RedisThrottlerStorage({ eval: eval_ } as unknown as Redis);

    const rec = await storage.increment('1.2.3.4', 60000, 5, 0, 'default');

    expect(rec).toEqual({ totalHits: 3, timeToExpire: 45, isBlocked: false, timeToBlockExpire: 0 });
    // key includes throttler name + tracker; 2 KEYS + ttl/limit/block ARGV
    expect(eval_).toHaveBeenCalledWith(
      expect.any(String), 2,
      'throttle:default:1.2.3.4', 'throttle:block:default:1.2.3.4',
      '60000', '5', '60000', // blockMs defaults to ttl when blockDuration=0
    );
  });

  it('reports blocked when over the limit', async () => {
    const eval_ = jest.fn().mockResolvedValue([6, 30000, 1, 30000]);
    const storage = new RedisThrottlerStorage({ eval: eval_ } as unknown as Redis);
    const rec = await storage.increment('ip', 60000, 5, 30000, 'default');
    expect(rec.isBlocked).toBe(true);
    expect(rec.timeToBlockExpire).toBe(30);
  });

  it('fails open if Redis errors (availability over strict limiting)', async () => {
    const eval_ = jest.fn().mockRejectedValue(new Error('CONN refused'));
    const storage = new RedisThrottlerStorage({ eval: eval_ } as unknown as Redis);
    const rec = await storage.increment('ip', 60000, 5, 0, 'default');
    expect(rec.isBlocked).toBe(false);
    expect(rec.totalHits).toBe(1);
  });
});
