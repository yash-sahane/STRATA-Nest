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

  it('verifies a hash produced outside Node (Python hashlib)', async () => {
    await expect(svc.verify('TestPass123!', REFERENCE_VECTOR)).resolves.toBe(true);
    await expect(svc.verify('WrongPassword', REFERENCE_VECTOR)).resolves.toBe(false);
  });

  it('round-trips its own hashes', async () => {
    const encoded = await svc.hash('s3cret-Password!');
    expect(encoded.startsWith('pbkdf2_sha256$')).toBe(true);
    await expect(svc.verify('s3cret-Password!', encoded)).resolves.toBe(true);
    await expect(svc.verify('nope', encoded)).resolves.toBe(false);
  });

  it('emits the standard 4-part pbkdf2_sha256 format', async () => {
    const parts = (await svc.hash('x')).split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2_sha256');
    expect(Number.parseInt(parts[1], 10)).toBeGreaterThan(0);
  });

  it('rejects malformed / non-pbkdf2 encodings', async () => {
    await expect(svc.verify('x', 'not-a-hash')).resolves.toBe(false);
    await expect(svc.verify('x', 'bcrypt$2b$...')).resolves.toBe(false);
    await expect(svc.verify('x', 'pbkdf2_sha256$abc$salt$hash')).resolves.toBe(false);
  });

  // Sign-in for an unknown address runs this in place of `verify`, so it has to
  // cost what `verify` costs against a current hash — and never say yes.
  it('verifies against a decoy at full cost, and never matches', async () => {
    const verify = jest.spyOn(svc, 'verify');
    await expect(svc.verifyDecoy('anything')).resolves.toBe(false);
    await expect(svc.verifyDecoy('')).resolves.toBe(false);
    const decoy = verify.mock.calls[0][1];
    expect(svc.needsRehash(decoy)).toBe(false); // today's algorithm and iteration count
    verify.mockRestore();
  });

  // pbkdf2Sync spent ~90 ms of CPU on the event loop per sign-in, freezing every
  // other request and socket for as long. The rounds belong on the thread pool.
  it('hashes off the event loop: timers keep firing while it works', async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    try {
      await svc.hash('keep-the-loop-free');
    } finally {
      clearInterval(timer);
    }
    // A synchronous hash would have held the loop for the whole run: zero ticks.
    expect(ticks).toBeGreaterThan(0);
  });
});
