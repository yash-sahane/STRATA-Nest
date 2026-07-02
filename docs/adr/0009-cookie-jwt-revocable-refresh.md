# ADR-0009 — Cookie JWT with server-tracked revocable refresh tokens

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Security

## Context
Auth is cookie-based SimpleJWT: `lt_access` (15 min) / `lt_refresh` (7 d), httpOnly (A§5.2). But the custom refresh view **manually rotates jti/exp and never blacklists the old token** — SimpleJWT's rotation/blacklist settings never take effect, so refresh tokens are effectively **non-revocable for 7 days** (A§5.3, D1). The frontend relies on a single silent refresh-on-401 (A§13).

## Decision
Keep the cookie-JWT model and names (ADR-0003), implemented with Passport + a cookie extractor. Make refresh tokens **server-tracked and revocable**: each carries a `jti` recorded in a Redis store (TTL = refresh lifetime); **rotation revokes the old jti**; logout deletes it. This finally realizes the rotation/blacklist intent.

## Consequences
- (+) Stolen/old refresh tokens can be invalidated immediately (closes D1).
- (+) Enables "log out everywhere" later.
- (−) Refresh now requires a Redis read/write — negligible, Redis is already present.
- Follow-up: coordinate the cutover with the frontend `tryRefresh()` flow so behavior stays seamless.

## Alternatives considered
- **Stateless refresh (no store):** rejected — cannot revoke; reproduces D1.
- **DB-backed token table:** viable but Redis TTL is simpler and matches token lifetimes.

## Traceability
A§5.2, A§5.3, A§13, D1 · §6, §15, M§8
