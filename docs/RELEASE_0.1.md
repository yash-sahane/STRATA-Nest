# Release 0.1 — Foundation Freeze

> **Purpose:** freeze the foundation (Architecture → Scaffold → Auth → Verification) as a reviewable, mergeable milestone **before** any more modules are stacked. `Freeze → Review → Merge → then Phase 2`.

## Scope (what's in 0.1)
| Area | State |
|---|---|
| Documentation | Audit, Migration Matrix, Target Architecture (+ r2/r3 review revisions), 12 ADRs, phase DoDs (0–12), API compatibility, Phase-1 auth plan, Phase-1A verification, benchmark, security checklist, this retrospective |
| Monorepo scaffold (Phase 0) | pnpm/turborepo; `@lt/common` (id byte-parity, envelopes, allowlisted query, `toDjangoIso`), `@lt/config` (Zod), `@lt/shared`, `@lt/prisma`, `@lt/testing`, `@lt/contract-tests`; `apps/api` + `apps/worker`; infra (Docker, compose, nginx) |
| Auth + Users (Phase 1) | Cookie JWT (SimpleJWT-compatible), Django `pbkdf2` passwords, **revocable refresh** (D1), directory scoping, invite; global auth guard |
| Hardening (Phase 1A) | Rate limiting (throttler), structured logging + correlation ids, `AuthAuditService` |

## Verified in this milestone
- ✅ `turbo run typecheck test` green — **20 tasks**; API **19 unit tests**.
- ✅ **Password** cross-compat (Django `make_password`/`check_password` ↔ Nest), bidirectional.
- ✅ **JWT** cross-compat (Django SimpleJWT ↔ Nest), bidirectional + tamper rejection.
- ✅ Cookie attributes (unit), throttler tracker (unit), audit events (unit).
- ✅ Full DI graph resolves; all `/api/v1/auth/*`, `/users`, `/health` routes map; clean runnable `dist`.

## NOT in 0.1 (deliberately)
- Any domain module beyond Auth/Users (Workspaces, Projects, Tasks, …).
- The **live Phase-1A run** (contract/e2e/benchmark vs real Django + Postgres + Redis) — see gate below.
- Redis-backed throttler storage; account lockout; CSRF-token (pending `SameSite` decision); real email transport (Phase 10).

## The gate before Phase 2 (must pass to call Phase 1 "complete")
Run [PHASE_1A_VERIFICATION.md](PHASE_1A_VERIFICATION.md) §3–§8 against the live stack:
1. `pnpm --filter @lt/api test:e2e` (Nest flows) — green.
2. Contract suite green vs Django **and** vs Nest.
3. `cross-verify.mjs` matrix — 4/4.
4. `AUTH_BENCHMARK.md` filled; no endpoint > 2× Django.
5. Manual browser pass (§8).
6. Security items acknowledged: JWT key ≥ 32 bytes; `AUTH_STRICT_REFRESH=true` planned post-cutover.

## Freeze → Review → Merge
- **Freeze:** no new modules on this branch until merged.
- **Review:** the docs above make each decision auditable; review the ADRs + Phase-1A results.
- **Merge:** land 0.1 as the stable base. Tag `v0.1.0`.
- Only then branch Phase 2 (Workspaces + RBAC).

> Everything to date is working-tree only — no commits made. Say the word to create the `release/0.1` branch + commit, or run the live gate first.
