# ADR-0009 — Cookie JWT with server-tracked revocable refresh tokens

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Security

## Context
Auth is cookie-based JWT: `strata_access` (15 min) / `strata_refresh` (7 d), httpOnly. A refresh flow that rotates the jti/exp **without revoking the old token** leaves refresh tokens effectively **non-revocable for their 7-day lifetime**. The frontend relies on a single silent refresh-on-401.

## Decision
Keep the cookie-JWT model and names (ADR-0003), implemented with Passport + a cookie extractor. Make refresh tokens **server-tracked and revocable**: each carries a `jti` recorded in a Redis store (TTL = refresh lifetime); **rotation revokes the old jti**; logout deletes it.

## Consequences
- (+) Stolen/old refresh tokens can be invalidated immediately.
- (+) Enables "log out everywhere" later.
- (−) Refresh now requires a Redis read/write — negligible, Redis is already present.
- The frontend `tryRefresh()` flow relies on this rotation staying seamless.

## Alternatives considered
- **Stateless refresh (no store):** rejected — cannot revoke a stolen refresh token.
- **DB-backed token table:** viable but Redis TTL is simpler and matches token lifetimes.

