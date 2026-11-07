import { AuthThrottlerGuard, clientAddress } from './auth-throttler.guard';
import { TrustedProxies } from './trusted-proxies';

// getTracker is protected and uses only the request (no injected deps), so we
// exercise it directly off the prototype.
type Trackable = { getTracker: (req: Record<string, unknown>) => Promise<string> };
const guard = () => Object.create(AuthThrottlerGuard.prototype) as Trackable;

describe('AuthThrottlerGuard.getTracker', () => {
  it('tracks by client IP for normal routes', async () => {
    expect(await guard().getTracker({ ip: '1.2.3.4', url: '/api/v1/auth/login', headers: {} })).toBe(
      '1.2.3.4',
    );
  });

  it('a caller connecting directly is keyed on its socket, whatever headers it sends', async () => {
    const t = await guard().getTracker({
      url: '/api/v1/auth/login',
      headers: { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' },
      socket: { remoteAddress: '203.0.113.9' },
    });
    expect(t).toBe('203.0.113.9');
  });

  // The finding: a LAN client, or Docker's port proxy (which connects from the
  // bridge gateway), sits on a private address — and was believed, so a fresh
  // X-Real-IP on every request was a fresh bucket on every request.
  it('does not believe a private address merely for being private', async () => {
    const fromTheLan = (realIp: string) =>
      guard().getTracker({
        url: '/api/v1/auth/login',
        headers: { 'x-real-ip': realIp, 'x-forwarded-for': realIp },
        socket: { remoteAddress: '172.18.0.1' },
      });
    expect(await fromTheLan('1.1.1.1')).toBe('172.18.0.1');
    expect(await fromTheLan('2.2.2.2')).toBe('172.18.0.1');
  });

  it('believes a proxy on this machine by default', async () => {
    const t = await guard().getTracker({
      url: '/api/v1/auth/login',
      headers: { 'x-real-ip': '8.8.4.4' },
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    });
    expect(t).toBe('8.8.4.4');
  });

  it('tracks password-reset by IP + email (lowercased)', async () => {
    const t = await guard().getTracker({
      ip: '1.2.3.4',
      originalUrl: '/api/v1/auth/password-reset',
      headers: {},
      body: { email: 'A@B.com' },
    });
    expect(t).toBe('1.2.3.4:a@b.com');
  });

  it('gives padded spellings of one address the same reset bucket', async () => {
    const forEmail = (email: string) =>
      guard().getTracker({
        ip: '1.2.3.4',
        originalUrl: '/api/v1/auth/password-reset',
        headers: {},
        body: { email },
      });
    expect(await forEmail('  a@b.com ')).toBe(await forEmail('a@b.com'));
  });

  it('does NOT include email for the reset-confirm route', async () => {
    const t = await guard().getTracker({
      ip: '1.2.3.4',
      originalUrl: '/api/v1/auth/password-reset/confirm',
      headers: {},
      body: {},
    });
    expect(t).toBe('1.2.3.4');
  });
});

describe('clientAddress behind a trusted proxy', () => {
  const NGINX = '172.18.0.5';
  const trusted = new TrustedProxies(NGINX);
  const viaNginx = (headers: Record<string, string>, peer = NGINX) =>
    clientAddress({ url: '/api/v1/auth/login', headers, socket: { remoteAddress: peer } }, trusted);

  // nginx sets X-Real-IP to the address it saw and APPENDS that address to
  // whatever X-Forwarded-For the caller sent.
  it('uses the address the proxy vouches for', () => {
    expect(viaNginx({ 'x-real-ip': '8.8.4.4', 'x-forwarded-for': '9.9.9.9, 8.8.4.4' })).toBe('8.8.4.4');
    // No X-Real-IP: the LAST hop is the one the proxy appended.
    expect(viaNginx({ 'x-forwarded-for': '9.9.9.9, 8.8.4.4' })).toBe('8.8.4.4');
  });

  it('a forged X-Forwarded-For does not buy a fresh bucket', () => {
    const attempt = (forged: string) =>
      viaNginx({ 'x-real-ip': '8.8.4.4', 'x-forwarded-for': `${forged}, 8.8.4.4` });
    expect(attempt('1.1.1.1')).toBe(attempt('2.2.2.2'));
  });

  it('believes only the proxies it was given — not their neighbours', () => {
    expect(viaNginx({ 'x-real-ip': '8.8.4.4' }, '172.18.0.1')).toBe('172.18.0.1');
  });

  it('keys on the proxy itself when it vouches for nothing usable', () => {
    expect(viaNginx({ 'x-real-ip': 'not-an-address' })).toBe(NGINX);
    expect(viaNginx({})).toBe(NGINX);
  });
});

describe('TrustedProxies', () => {
  it('reads addresses, ranges and loopback', () => {
    const t = new TrustedProxies('10.0.0.5, 192.168.10.0/24, fd00::/8, loopback');
    for (const ip of ['10.0.0.5', '::ffff:10.0.0.5', '192.168.10.77', 'fd12::1', '127.0.0.1', '::1']) {
      expect(t.has(ip)).toBe(true);
    }
    for (const ip of ['10.0.0.6', '192.168.11.1', '2001:db8::1', 'unknown', '']) {
      expect(t.has(ip)).toBe(false);
    }
  });

  it('trusts nobody when told nobody', () => {
    const t = new TrustedProxies('');
    expect(t.has('127.0.0.1')).toBe(false);
    expect(t.has('172.18.0.5')).toBe(false);
  });

  // The compose stack's nginx has no fixed address — only its service name.
  it('looks up a proxy named by host name', async () => {
    const resolve = jest.fn().mockResolvedValue(['172.18.0.7']);
    const t = new TrustedProxies('nginx', resolve);
    await t.ready();
    expect(resolve).toHaveBeenCalledWith('nginx');
    expect(t.has('172.18.0.7')).toBe(true);
    expect(t.has('172.18.0.1')).toBe(false);
  });

  it('refuses an entry it cannot read, at boot rather than by trusting it', () => {
    expect(() => new TrustedProxies('10.0.0.0/33')).toThrow();
    expect(() => new TrustedProxies('10.0.0.256')).toThrow(/TRUSTED_PROXIES/);
    expect(() => new TrustedProxies('http://nginx')).toThrow(/TRUSTED_PROXIES/);
  });
});
