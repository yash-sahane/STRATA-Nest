/**
 * Rate-limit configuration (AUTH_SECURITY_CHECKLIST). Read from process.env at
 * import time (main.ts loads .env first), so limits are configurable per env.
 * TTLs are seconds in the environment; @nestjs/throttler expects milliseconds.
 */
function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const THROTTLE = {
  default: {
    ttl: num(process.env.THROTTLE_DEFAULT_TTL, 60) * 1000,
    limit: num(process.env.THROTTLE_DEFAULT_LIMIT, 120),
  },
  login: {
    ttl: num(process.env.THROTTLE_LOGIN_TTL, 60) * 1000,
    limit: num(process.env.THROTTLE_LOGIN_LIMIT, 5),
  },
  refresh: {
    ttl: num(process.env.THROTTLE_REFRESH_TTL, 60) * 1000,
    limit: num(process.env.THROTTLE_REFRESH_LIMIT, 20),
  },
  reset: {
    ttl: num(process.env.THROTTLE_RESET_TTL, 3600) * 1000,
    limit: num(process.env.THROTTLE_RESET_LIMIT, 3),
  },
} as const;
