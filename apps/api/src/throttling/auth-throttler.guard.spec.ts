import { AuthThrottlerGuard } from './auth-throttler.guard';

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

  it('prefers X-Forwarded-For (behind nginx)', async () => {
    const t = await guard().getTracker({
      url: '/api/v1/auth/login',
      headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' },
      socket: { remoteAddress: '10.0.0.1' },
    });
    expect(t).toBe('9.9.9.9');
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
