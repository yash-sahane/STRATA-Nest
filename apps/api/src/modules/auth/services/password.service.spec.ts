import { PasswordService } from './password.service';

/**
 * Cross-compatibility with Django's PBKDF2PasswordHasher (PHASE_1_AUTH_PLAN §6/§7).
 * DJANGO_VECTOR was produced independently via Python hashlib (the same primitive
 * Django uses) for password "TestPass123!", salt "saltSALT1234", 390000 iterations.
 */
describe('PasswordService — Django pbkdf2_sha256 compatibility', () => {
  const svc = new PasswordService();
  const DJANGO_VECTOR =
    'pbkdf2_sha256$390000$saltSALT1234$kw2YEBw/ha7x0mgvwjB5lnInn4P94npsqF058RwjAEA=';

  it('verifies a hash produced outside Node (Django/hashlib)', () => {
    expect(svc.verify('TestPass123!', DJANGO_VECTOR)).toBe(true);
    expect(svc.verify('WrongPassword', DJANGO_VECTOR)).toBe(false);
  });

  it('round-trips its own hashes', () => {
    const encoded = svc.hash('s3cret-Password!');
    expect(encoded.startsWith('pbkdf2_sha256$')).toBe(true);
    expect(svc.verify('s3cret-Password!', encoded)).toBe(true);
    expect(svc.verify('nope', encoded)).toBe(false);
  });

  it('emits the Django-readable 4-part format', () => {
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
