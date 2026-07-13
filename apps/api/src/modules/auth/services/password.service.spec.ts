import { PasswordService } from './password.service';

/**
 * Cross-implementation compatibility for PBKDF2-SHA256 password hashing.
 * REFERENCE_VECTOR was produced independently via Python hashlib (the same
 * primitive this format targets) for password "TestPass123!", salt
 * "saltSALT1234", 390000 iterations.
 */
describe('PasswordService — pbkdf2_sha256 cross-implementation compatibility', () => {
  const svc = new PasswordService();
  const REFERENCE_VECTOR =
    'pbkdf2_sha256$390000$saltSALT1234$kw2YEBw/ha7x0mgvwjB5lnInn4P94npsqF058RwjAEA=';

  it('verifies a hash produced outside Node (Python hashlib)', () => {
    expect(svc.verify('TestPass123!', REFERENCE_VECTOR)).toBe(true);
    expect(svc.verify('WrongPassword', REFERENCE_VECTOR)).toBe(false);
  });

  it('round-trips its own hashes', () => {
    const encoded = svc.hash('s3cret-Password!');
    expect(encoded.startsWith('pbkdf2_sha256$')).toBe(true);
    expect(svc.verify('s3cret-Password!', encoded)).toBe(true);
    expect(svc.verify('nope', encoded)).toBe(false);
  });

  it('emits the standard 4-part pbkdf2_sha256 format', () => {
    const parts = svc.hash('x').split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2_sha256');
    expect(Number.parseInt(parts[1], 10)).toBeGreaterThan(0);
  });

  it('rejects malformed / non-pbkdf2 encodings', () => {
    expect(svc.verify('x', 'not-a-hash')).toBe(false);
    expect(svc.verify('x', 'bcrypt$2b$...')).toBe(false);
    expect(svc.verify('x', 'pbkdf2_sha256$abc$salt$hash')).toBe(false);
  });
});
