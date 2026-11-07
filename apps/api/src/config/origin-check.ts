import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A request that changes something, and says where it came from, must have come
 * from one of ours.
 *
 * The session is a cookie, and a browser attaches a cookie to any request for
 * the site it belongs to — including one another site's page made the browser
 * send. What stood between that and a write was the cookie's SameSite setting
 * alone, which is a deployment option (`JWT_COOKIE_SAMESITE=None` is a valid
 * value, and the one a cross-site deployment has to choose). CORS does not help:
 * it decides whether the other site may READ the answer, after the write has
 * happened.
 *
 * Browsers put an `Origin` header on every cross-origin request and on every
 * same-origin one that is not a GET or HEAD, and a page cannot forge it. So for
 * the methods that change things: when the header is there, it has to name an
 * origin on the allow-list (the same list CORS is given) or the API's own.
 *
 * A request with no `Origin` is not a browser's cross-site request — it is a
 * server, a script, a webhook — and is left to the authentication it carries.
 */
export function originCheck(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins.map((origin) => origin.replace(/\/+$/, '').toLowerCase()));

  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) return next();
    const header = req.headers.origin;
    if (!header) return next();
    const origin = String(header).replace(/\/+$/, '').toLowerCase();
    if (allowed.has(origin) || isOwnOrigin(origin, req)) return next();
    res.status(403).json({
      error: {
        message: 'This request came from a site that is not allowed to make it.',
        code: 403,
        type: 'OriginNotAllowed',
      },
    });
  };
}

/** The API's own pages (Swagger UI) call it from its own origin. */
function isOwnOrigin(origin: string, req: Request): boolean {
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === String(host).toLowerCase();
  } catch {
    return false;
  }
}
