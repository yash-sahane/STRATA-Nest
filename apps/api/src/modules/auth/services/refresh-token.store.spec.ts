import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { RefreshTokenStore } from './refresh-token.store';

/** Minimal in-memory Redis stand-in for the store's commands. */
class FakeRedis {
  private readonly map = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();
  async set(key: string, value: string): Promise<'OK'> {
    this.map.set(key, value);
    return 'OK';
  }
  async exists(key: string): Promise<number> {
    return this.map.has(key) ? 1 : 0;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.map.delete(k) || this.sets.delete(k)) n += 1;
    return n;
  }
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async sadd(key: string, member: string): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    this.sets.set(key, set);
    return set.has(member) ? 0 : (set.add(member), 1);
  }
  async srem(key: string, member: string): Promise<number> {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
  async expire(): Promise<number> {
    return 1;
  }
  /** Commands queued, then run in order by exec() — what MULTI does. */
  multi() {
    const queued: Array<() => Promise<unknown>> = [];
    const chain = {
      set: (k: string, v: string) => (queued.push(() => this.set(k, v)), chain),
      sadd: (k: string, m: string) => (queued.push(() => this.sadd(k, m)), chain),
      srem: (k: string, m: string) => (queued.push(() => this.srem(k, m)), chain),
      del: (...k: string[]) => (queued.push(() => this.del(...k)), chain),
      expire: () => (queued.push(() => this.expire()), chain),
      exec: async () => {
        for (const run of queued) await run();
        return [];
      },
    };
    return chain;
  }
}

const cfg = { get: (_k: string, def?: unknown) => def } as unknown as ConfigService;
const newStore = (events?: { emit: jest.Mock }) =>
  new RefreshTokenStore(new FakeRedis() as unknown as Redis, cfg, events as never);

describe('RefreshTokenStore — revocable refresh tokens (fixes D1)', () => {
  it('stores, confirms, and revokes a jti', async () => {
    const store = newStore();
    await store.store('u1', 'jti1');
    expect(await store.isActive('u1', 'jti1')).toBe(true);
    await store.revoke('u1', 'jti1');
    expect(await store.isActive('u1', 'jti1')).toBe(false);
  });

  it('rotation invalidates the old jti and activates the new one', async () => {
    const store = newStore();
    await store.store('u1', 'old');
    await store.revoke('u1', 'old'); // rotate
    await store.store('u1', 'new');
    expect(await store.isActive('u1', 'old')).toBe(false);
    expect(await store.isActive('u1', 'new')).toBe(true);
  });

  it('revokeAll clears every jti for a user only', async () => {
    const store = newStore();
    await store.store('u1', 'a');
    await store.store('u1', 'b');
    await store.store('u2', 'c');
    await store.revokeAll('u1');
    expect(await store.isActive('u1', 'a')).toBe(false);
    expect(await store.isActive('u1', 'b')).toBe(false);
    expect(await store.isActive('u2', 'c')).toBe(true);
  });

  // Revoking refresh tokens alone left the access token already handed out
  // working for up to fifteen minutes, on every route and on the socket.
  it('revokeAll marks when the sessions ended, so older access tokens are refused', async () => {
    const store = newStore();
    expect(await store.revokedBefore('u1')).toBe(0);
    const before = Math.floor(Date.now() / 1000);
    await store.revokeAll('u1');
    const mark = await store.revokedBefore('u1');
    expect(mark).toBeGreaterThanOrEqual(before);
    expect(await store.revokedBefore('u2')).toBe(0);
  });

  it('revokeAll tells the rest of the system, so open sockets close', async () => {
    const emit = jest.fn();
    const store = newStore({ emit });
    await store.revokeAll('u1');
    expect(emit).toHaveBeenCalledWith(
      'auth.sessions_revoked',
      expect.objectContaining({ payload: { userId: 'u1' } }),
    );
  });
});
