import type { ConfigService } from '@nestjs/config';
import { TokenCipher } from './token-cipher';

const cipher = (key = 'super-secret-key'): TokenCipher =>
  new TokenCipher({ get: (_k: string, d?: unknown) => key ?? d } as never as ConfigService);

describe('TokenCipher (access-token encryption at rest, D4)', () => {
  it('round-trips encrypt → decrypt', () => {
    const c = cipher();
    const token = 'ghp_ABCDEFghijkl1234567890';
    const enc = c.encrypt(token);
    expect(c.decrypt(enc)).toBe(token);
  });

  it('never stores plaintext (ciphertext is prefixed and differs)', () => {
    const c = cipher();
    const token = 'gitlab-pat-xyz';
    const enc = c.encrypt(token);
    expect(enc).not.toContain(token);
    expect(enc.startsWith('enc:v1:')).toBe(true);
  });

  it('produces a fresh IV each call (same input → different ciphertext)', () => {
    const c = cipher();
    expect(c.encrypt('same')).not.toBe(c.encrypt('same'));
  });

  it('refuses a value it did not write, rather than handing it back as the secret', () => {
    expect(() => cipher().decrypt('plain-token')).toThrow('Not an encrypted secret.');
  });
});
