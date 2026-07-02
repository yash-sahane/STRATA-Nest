# Migration Status — Single Source of Truth

> The one dashboard for the Django → NestJS migration. Every other doc is detail; **this is the index of truth.** Update it as each item lands.
>
> **Legend:** ✅ done & verified · 🚧 implemented, live verification pending · ⏳ not started · 🟡 follow-up / non-blocking · ❌ gap

_Last updated: 2026-07-01 · Release line: **0.1 (frozen)**_

---

## Architecture & Docs
```
✅ Current System Audit              docs/CURRENT_SYSTEM_AUDIT.md
✅ Migration Matrix                  docs/MIGRATION_MATRIX.md
✅ Target Architecture (r3)          docs/TARGET_ARCHITECTURE_NESTJS.md
✅ ADRs (0001–0012)                  docs/adr/
✅ Phase Definition-of-Done (0–12)   docs/phases/
✅ API Compatibility ledger          docs/API_COMPATIBILITY.md
✅ Phase 1 Auth Plan                 docs/PHASE_1_AUTH_PLAN.md
✅ Phase 1A Verification guide       docs/PHASE_1A_VERIFICATION.md
✅ Auth Benchmark harness            docs/AUTH_BENCHMARK.md   (numbers pending live run)
✅ Auth Security Checklist           docs/AUTH_SECURITY_CHECKLIST.md
✅ Phase 1 Retrospective             docs/PHASE_1_RETROSPECTIVE.md
✅ Release 0.1 milestone             docs/RELEASE_0.1.md
```

## Implementation (Migration Order Matrix · M§9)
```
✅  Phase 0   Foundations (monorepo, common/config/shared/prisma/testing, infra, harness)
🚧  Phase 1   Auth + Users            implemented + unit-verified; live gate pending
🚧  Phase 2   Workspaces + RBAC       implemented + unit-verified; live gate pending
🚧  Phase 3   Projects                implemented + unit-verified; live gate pending
🚧  Phase 4   Requirements (CR + FR)  implemented + unit-verified; live gate pending
🚧  Phase 5   Epics + Sprints + Retrospectives    implemented + unit-verified; live gate pending
🚧  Phase 6   Tasks (+ Comments, Kanban, Labels)   implemented + unit-verified; live gate pending
🚧  Phase 7   Realtime gateway + event bus          implemented + unit-verified; live gate pending
🚧  Phase 8   Attendance, Leave, Time Tracking       implemented + unit-verified; live gate pending
⏳  Phase 9   Notifications + Activity
⏳  Phase 10  Files + Email queue
⏳  Phase 11  Integrations (webhooks, Git queue, token encryption)
⏳  Phase 12  Generation + AI + Django decommission
```

## Verification (Phase 1 / 1A)
```
✅  Password cross-compat   Django pbkdf2 ↔ Nest (bidirectional, unit)
✅  JWT cross-compat        SimpleJWT claims ↔ Nest (bidirectional + tamper reject, unit)
✅  Cookie attributes       unit (parseSetCookies)
✅  Throttler tracker       unit
✅  Audit events            unit
✅  DI graph + routes       full resolve; all /auth/*, /users, /health mapped
⏳  Contract suite (live)   vs real Django AND vs Nest        ← GATE
⏳  E2E flows (live)        login→me→refresh→logout; refresh-reuse reject; multi-tab
⏳  Benchmark (live)        login/refresh/me/profile vs Django
⏳  Browser pass (live)     real frontend: idle-expiry, multi-tab, logout, reset
```

## Security
```
✅  Refresh rotation + revocation (closes D1)
✅  Rate limiting (login/refresh/register/reset, env-configurable)
✅  Secret redaction in logs
✅  Authorized-only by default (global JwtAuthGuard + @Public opt-out)
✅  Workspace RBAC — policy-based, flag-gated (RBAC_ENFORCED); membership scoping (closes D3, Phase 2)
✅  Authorized realtime rooms — broadcast filtered by workspace membership (closes D2, Phase 7)
✅  Server-side leave/time approval + balance deduction, self-approval blocked (closes D9, Phase 8)
🟡  Redis throttler storage      needed before multi-instance scale-out
🟡  Strict refresh mode          flip AUTH_STRICT_REFRESH=true after dual-run window
🟡  CSRF token                   add if SameSite=None ever required
🟡  Account lockout              deferred (product decision)
⏳  JWT signing key ≥ 32 bytes   enforce in prod config (= Django SECRET_KEY)
```

## Observability
```
✅  Structured JSON logging (pino)
✅  Correlation id per request (X-Request-Id in/out)
✅  Auth audit events (login/refresh/failure/reset/logout/register)
```

---

## Current gate (blocks calling Phase 1 "complete" → blocks Phase 2)
Run [PHASE_1A_VERIFICATION.md](PHASE_1A_VERIFICATION.md) §3–§8 against the live stack (Postgres + Redis + Django + Nest). When **all Verification rows above are ✅** and the security ⏳ items are acknowledged: tag `v0.1.0`, merge `release/0.1` → `main`, then branch `feature/phase2-workspaces`.

**Do not begin Phase 2 until the gate passes.**
