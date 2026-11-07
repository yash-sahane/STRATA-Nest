import type { Request, Response } from 'express';
import { originCheck } from './origin-check';

/**
 * The session is a cookie, and a browser attaches a cookie to any request for
 * the site it belongs to. What stood between another site's page and a write
 * was the cookie's SameSite setting alone — a deployment option.
 */
describe('originCheck', () => {
  const check = originCheck(['http://localhost:3000', 'https://app.acme.io/']);

  function send(method: string, headers: Record<string, string>) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    check({ method, headers } as unknown as Request, res as unknown as Response, next);
    return { next, res };
  }

  it('lets a write from an allowed origin through', () => {
    expect(send('POST', { origin: 'http://localhost:3000' }).next).toHaveBeenCalled();
    // The list may carry a trailing slash, and a header never does.
    expect(send('DELETE', { origin: 'https://app.acme.io' }).next).toHaveBeenCalled();
  });

  it('refuses a write another site made the browser send', () => {
    const { next, res } = send('POST', { origin: 'https://evil.example', host: 'api.acme.io' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: 403, type: 'OriginNotAllowed' }),
    });
  });

  it('does not confuse a look-alike origin with an allowed one', () => {
    for (const origin of ['http://localhost:3000.evil.example', 'http://localhost:30000', 'null']) {
      expect(send('PATCH', { origin, host: 'localhost:8000' }).next).not.toHaveBeenCalled();
    }
  });

  // A server, a script, a provider's webhook: not a browser's cross-site
  // request, and left to the authentication it carries.
  it('leaves a request with no Origin to its authentication', () => {
    expect(send('POST', {}).next).toHaveBeenCalled();
  });

  it('never stands in the way of a read', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(send(method, { origin: 'https://evil.example' }).next).toHaveBeenCalled();
    }
  });

  it('lets the API’s own pages call it', () => {
    expect(send('POST', { origin: 'http://localhost:8000', host: 'localhost:8000' }).next).toHaveBeenCalled();
  });
});
