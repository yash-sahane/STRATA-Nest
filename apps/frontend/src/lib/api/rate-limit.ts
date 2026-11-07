import { ApiError } from './rest-client';

/**
 * The API's request throttler said no.
 *
 * Its own words are "ThrottlerException: Too Many Requests", which tells a person
 * neither what happened nor what to do, so screens that can meet it say it in
 * their own terms. A 429 that brings its own explanation — the sign-in lockout's
 * `TooManyAttempts`, which names how long to wait and offers a reset — is not this.
 */
export function isThrottled(error: unknown): boolean {
  return error instanceof ApiError && error.code === 429 && error.type === 'Throttled';
}

/**
 * "in 40 seconds" / "in 3 minutes": how long the 429's Retry-After asks for, or
 * `fallback` when it did not say.
 */
export function retryWait(error: unknown, fallback: string): string {
  const ms = error instanceof ApiError ? error.retryAfterMs : undefined;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return fallback;
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
