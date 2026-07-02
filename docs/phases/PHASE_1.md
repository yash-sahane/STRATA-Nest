# Phase 1 — Auth + Users

**Status: 🚧 Implemented + unit-verified; live contract/e2e pending a DB+Django environment.** Detailed design: [PHASE_1_AUTH_PLAN.md](../PHASE_1_AUTH_PLAN.md).

**Done in this environment:** `AuthModule` + `UsersModule` fully coded and wired (DI graph resolves, all routes mapped); `PasswordService` verified against an independent Django/hashlib pbkdf2 vector; `TokenService` (SimpleJWT-compatible claims) and `RefreshTokenStore` (revocable rotation, D1) unit-tested; typecheck + 10 unit tests green.
**Pending (needs the shared Postgres + running Django):** run characterization → contract suite per endpoint (flip [API_COMPATIBILITY](../API_COMPATIBILITY.md) rows to ✅), the login→me→refresh→logout e2e, the refresh-reuse-rejection e2e, and dual-run cross-verification.

## Goal
Port authentication and the user directory to NestJS with byte-identical wire behavior, while fixing refresh-token revocation (D1) — everything else depends on this.

## Scope
- `AuthModule`: `login`, `logout`, `refresh`, `register`, `me`, `change-password`, `profile`, `password-reset`, `password-reset/confirm` (A§5.3).
- `UsersModule`: `GET /users` (shared-workspace directory), `GET /users/{id}`, `PATCH /users/{id}` (self/admin), `POST /users/invite`.
- Cookie JWT (`lt_access`/`lt_refresh`), Passport strategies, `JwtAuthGuard` (global) + `@Public()`.
- **Server-tracked, revocable refresh tokens** in Redis (fixes D1, ADR-0009).
- Introspect `User` + related tables into Prisma; preserve 20-char string PK (ADR-0002).

## Out of Scope
- RBAC/permission enforcement beyond authentication + `is_admin_flag`/superuser (that's Phase 2).
- Workspace membership *workflows* (invite creates membership rows, but join/accept flows are Phase 2).
- Realtime, queues (invite/reset emails may temporarily send inline or stub until Phase 10).

## Deliverables
- `AuthModule` + `UsersModule` (controllers/services, DTOs, guards, strategies).
- Prisma `User` model (introspected) + `RefreshToken` store (Redis).
- Characterization tests (Django) + contract tests (Nest) for every auth/user endpoint.
- `@lt/testing` auth helpers (mint/carry cookies).
- nginx route flags for `auth/*`, `users/*`.
- Updated [API_COMPATIBILITY.md](../API_COMPATIBILITY.md) rows → ✓.

## Acceptance Criteria
- [ ] Every Phase-1 endpoint passes the contract suite (identical status, body, cookies) vs Django.
- [ ] `login`/`refresh` set identical cookies (names, flags, max-age); frontend `tryRefresh()` works unchanged.
- [ ] Refresh **rotates and revokes** the old token (old refresh 401s after use) — a test proves it.
- [ ] `me` returns identical `{user, session, workspaceIds, hasTempPassword, isAdmin}`.
- [ ] `users` directory scoping matches Django (shared-workspace peers; admin sees all).
- [ ] Password validation + reset token flow reproduce Django behavior.
- [ ] Migration protocol followed (char test → contract test → flag) for each endpoint.

## Rollback Strategy
Per-endpoint nginx flag: flip `auth/*` and `users/*` back to Django instantly. Refresh-token store is additive (Redis); reverting ignores it. No schema writes beyond reads + the Redis token set — no destructive DB change. Django remains the auth source until flip is 100% and stable.

## Risks
- **Refresh-token semantics change** (D1 fix) could log users out unexpectedly → dark-launch, keep a compatibility window honoring existing Django-issued cookies.
- **Password hash compatibility** (Django PBKDF2 vs Nest) → verify Nest can validate existing Django hashes, or force reset path; decided in the plan.
- **Cookie attribute mismatch** (SameSite/Secure/domain) → asserted by contract tests before flip.
