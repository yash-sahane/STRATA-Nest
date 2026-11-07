import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { LoginAttemptStore } from './login-attempt.store';

/**
 * Failed sign-ins counted per (account, address), with a ceiling for the
 * account as a whole. Counting by account alone let anybody lock a colleague
 * out; counting by address alone did nothing about many machines guessing.
 */
describe('LoginAttemptStore', () => {
  /** A Redis small enough to read: hashes with a time to live. */
  function build(settings: Record<string, number> = {}) {
    const hashes = new Map<string, Map<string, number>>();
    const ttls = new Map<string, number>();
    const redis = {
      hmget: jest.fn(async (key: string, ...fields: string[]) =>
        fields.map((f) => {
          const v = hashes.get(key)?.get(f);
          return v === undefined ? null : String(v);
        }),
      ),
      hincrby: jest.fn(async (key: string, field: string, by: number) => {
        const h = hashes.get(key) ?? new Map<string, number>();
        h.set(field, (h.get(field) ?? 0) + by);
        hashes.set(key, h);
        return h.get(field) as number;
      }),
      expire: jest.fn(async (key: string, seconds: number) => {
        ttls.set(key, seconds);
        return 1;
      }),
      ttl: jest.fn(async (key: string) => (ttls.has(key) ? (ttls.get(key) as number) : hashes.has(key) ? -1 : -2)),
      del: jest.fn(async (key: string) => {
        hashes.delete(key);
        ttls.delete(key);
        return 1;
      }),
    };
    const config = {
      get: (key: string, fallback: number) => settings[key] ?? fallback,
    } as unknown as ConfigService;
    return { store: new LoginAttemptStore(redis as unknown as Redis, config), redis, hashes };
  }

  const fail = async (store: LoginAttemptStore, email: string, address: string, times: number) => {
    for (let i = 0; i < times; i += 1) await store.recordFailure(email, address);
  };

  it('takes guesses from one address until the limit, and none after it', async () => {
    const { store } = build({ AUTH_LOCKOUT_ATTEMPTS: 3, AUTH_LOCKOUT_WINDOW: 600 });
    await fail(store, 'a@x.com', '1.1.1.1', 2);
    expect(await store.lockedFor('a@x.com', '1.1.1.1')).toBe(0);
    await fail(store, 'a@x.com', '1.1.1.1', 1);
    expect(await store.lockedFor('a@x.com', '1.1.1.1')).toBe(600);
  });

  // The colleague who knows your address locks out only themselves.
  it('does not lock the account out for somebody signing in from elsewhere', async () => {
    const { store } = build({ AUTH_LOCKOUT_ATTEMPTS: 3, AUTH_LOCKOUT_WINDOW: 600 });
    await fail(store, 'a@x.com', '6.6.6.6', 3);
    expect(await store.lockedFor('a@x.com', '6.6.6.6')).toBe(600);
    expect(await store.lockedFor('a@x.com', '1.1.1.1')).toBe(0);
  });

  // Many machines guessing slowly still run into a limit.
  it('locks the account from everywhere once the attempts from all addresses reach the ceiling', async () => {
    const { store } = build({ AUTH_LOCKOUT_ATTEMPTS: 2, AUTH_LOCKOUT_WINDOW: 600 });
    for (let i = 0; i < 10; i += 1) await store.recordFailure('a@x.com', `10.0.0.${i}`);
    expect(await store.lockedFor('a@x.com', '1.1.1.1')).toBe(600);
  });

  // Change-password asks this way: the owner is already signed in, and somebody
  // else's guessing at the sign-in page is no reason to refuse them.
  it('can ask about one address alone, leaving the ceiling out of it', async () => {
    const { store } = build({ AUTH_LOCKOUT_ATTEMPTS: 2, AUTH_LOCKOUT_WINDOW: 600 });
    for (let i = 0; i < 10; i += 1) await store.recordFailure('a@x.com', `10.0.0.${i}`);
    expect(await store.lockedFor('a@x.com', 'change-password', { accountWide: false })).toBe(0);
    await fail(store, 'a@x.com', 'change-password', 2);
    expect(await store.lockedFor('a@x.com', 'change-password', { accountWide: false })).toBe(600);
  });

  it('counts each account on its own', async () => {
    const { store } = build({ AUTH_LOCKOUT_ATTEMPTS: 3 });
    await fail(store, 'a@x.com', '1.1.1.1', 3);
    expect(await store.lockedFor('b@x.com', '1.1.1.1')).toBe(0);
  });

  // The pause ends when it said it would: more guesses do not push it back.
  it('starts the window at the first failure and does not extend it', async () => {
    const { store, redis } = build({ AUTH_LOCKOUT_ATTEMPTS: 3 });
    await fail(store, 'a@x.com', '1.1.1.1', 5);
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });

  it('forgets the failures once the right password is given, or a new one is set', async () => {
    const { store } = build({ AUTH_LOCKOUT_ATTEMPTS: 3 });
    await fail(store, 'a@x.com', '1.1.1.1', 3);
    await store.clear('a@x.com');
    expect(await store.lockedFor('a@x.com', '1.1.1.1')).toBe(0);
  });

  // This is a list of the accounts somebody is attacking.
  it('never writes the account or the address itself', async () => {
    const { store, hashes } = build();
    await store.recordFailure('victim@x.com', '203.0.113.9');
    const written = [...hashes.entries()].map(([k, h]) => `${k} ${[...h.keys()].join(' ')}`).join(' ');
    expect(written).not.toContain('victim');
    expect(written).not.toContain('203.0.113.9');
  });

  it('pauses nobody when the store cannot be reached', async () => {
    const { store, redis } = build({ AUTH_LOCKOUT_ATTEMPTS: 1 });
    redis.hmget.mockRejectedValue(new Error('redis is down'));
    redis.hincrby.mockRejectedValue(new Error('redis is down'));
    await expect(store.recordFailure('a@x.com', '1.1.1.1')).resolves.toBeUndefined();
    expect(await store.lockedFor('a@x.com', '1.1.1.1')).toBe(0);
  });

  it('is switched off by a limit of zero', async () => {
    const { store, redis } = build({ AUTH_LOCKOUT_ATTEMPTS: 0 });
    await fail(store, 'a@x.com', '1.1.1.1', 50);
    expect(await store.lockedFor('a@x.com', '1.1.1.1')).toBe(0);
    expect(redis.hincrby).not.toHaveBeenCalled();
  });
});
