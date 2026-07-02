import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { RefreshTokenStore } from './refresh-token.store';

/** Minimal in-memory Redis stand-in for the store's commands. */
class FakeRedis {
  private readonly map = new Map<string, string>();
  async set(key: string, value: string): Promise<'OK'> {
    this.map.set(key, value);
    return 'OK';
  }
  async exists(key: string): Promise<number> {
    return this.map.has(key) ? 1 : 0;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.map.delete(k)) n += 1;
    return n;
  }
  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace('*', '');
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

const cfg = { get: (_k: string, def?: unknown) => def } as unknown as ConfigService;
const newStore = () => new RefreshTokenStore(new FakeRedis() as unknown as Redis, cfg);

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
});
