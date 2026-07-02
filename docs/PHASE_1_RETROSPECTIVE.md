# Phase 1 Retrospective — Auth + Users (+ Phase 1A)

> Written before Phase 2 so lessons compound. Covers Phase 0 (scaffold) → Phase 1 (auth impl) → Phase 1A (verification + hardening).

## What went well
- **Audit-first paid off.** Grounding the design in the real Django code (soft FKs, D1 refresh gap, WS broadcast leak, client-side business logic) meant zero invented features and a migration matrix that mapped 1:1.
- **Frozen-contract primitives landed in Phase 0.** id-gen (byte-parity), error/pagination envelopes, the allowlisted query parser, and DRF-type mapping were in place *before* any module, so Auth inherited them for free.
- **Highest risks retired with real evidence, early.** Password (`pbkdf2_sha256`) and JWT (SimpleJWT claims) were cross-verified **bidirectionally against the actual Django libraries** — the two things most likely to silently break existing users are proven.
- **The migration protocol held.** Nothing was declared "done" on assertion; unverifiable items were marked `PENDING` with instruments, not fake ✅.
- **`packages/testing` + `packages/common`** prevented utility duplication and gave the e2e/contract suites shared helpers (`parseSetCookies`, id-gen).
- **Repository-optional decision** (ADR-0004) kept the services lean — no boilerplate repos over CRUD.

## Unexpected issues
- **Monorepo build correctness.** Consuming workspace packages as TS *source* produced a nested, non-runnable `dist` and left `require('@lt/common')` pointing at TS. Fixed by having packages emit their own `dist` and resolve via `node_modules` (apps stay clean). **Lesson: settle the build/resolution model before it bites at runtime.**
- **Prisma won't generate from an empty schema** → a temporary `ScaffoldProbe` model in Phase 0 (removed when `User` landed).
- **Datetime precision.** Django emits 6-digit microseconds; JS `Date` is ms. `toDjangoIso` pads `.SSS000Z`; legacy Django rows may differ in sub-ms digits (documented parity item).
- **DRF error shapes vary** (list vs dict vs plain `{message}` vs error-envelope) per endpoint; reproducing each exactly took care (soft-error results + status→DRF-type mapping).
- **No live DB/Redis/Django in the build env.** Full live verification (contract/e2e/benchmark) could not run here — so Phase 1A produced **offline crypto evidence + ready-to-run instruments**, and Phase 1 stays not-complete until the live gate runs.
- **`@Throttle` reads config at import time** → had to `import 'dotenv/config'` before `AppModule` so env-driven limits apply.

## Architecture changes (vs the Phase-1 design)
- **Packages emit `dist`** (not pure source consumption). Load-bearing correctness change.
- New low-risk infra added mid-phase: `RedisModule` (shared client), `MailService` stub (real send → Phase 10 queue), `AuthAuditService`, `AuthThrottlerGuard`, pino `LoggerModule`.
- Parity helpers in `@lt/common`: `toDjangoIso`, DRF-type-by-status mapping in the exception filter.
- Minimal `Workspace`/`WorkspaceMember` Prisma models added early (auth reads them); full module is Phase 2.

## Bugs found
- **Build/config bugs (ours), caught pre-runtime:** composite/`rootDir` rejecting cross-package source; nested-dist + TS `require`. Both fixed.
- **Pre-existing Django issues (from the audit), now addressed:** D1 refresh non-revocation (fixed via Redis jti store), D17 `me` membership-status quirk (reproduced deliberately, flagged for later).
- No new *product* bugs found yet — that is precisely what the live Phase 1A run exists to surface.

## Performance observations
- **Login is PBKDF2-bound**, not framework-bound (Django 870k iters vs Nest 600k) → expect comparable latency; **benchmark harness ready, numbers pending live run**.
- Removed an N+1: user directory / `workspaceIds` uses a **batched** `toResponseMany`.
- No production numbers yet (no live env) — do **not** claim performance parity until `AUTH_BENCHMARK.md` is filled.

## Security observations
- pw + JWT cross-compat proven; **refresh revocation (D1) fixed**.
- **Rate limiting added** (throttler); **account lockout deferred** (product decision).
- **JWT signing key must be ≥ 32 bytes** (surfaced by a real warning at 30 bytes).
- **CSRF** posture depends on the final `SameSite`; **multi-instance** needs a shared Redis throttler storage.
- Structured **audit logging + correlation ids** added from day one.

## Things to carry into Phase 2
1. **Stand up the live verification env FIRST** (Postgres + Redis + Django) so contract/e2e run *continuously*, not just at the gate. Biggest lesson: don't let unverified evidence pile up.
2. **Introspect the Prisma model + run one smoke query as step 1** of each phase, validating the DB shape early.
3. **Parity before "fixes":** reproduce Django quirks, prove parity, *then* change behavior deliberately (as with D17).
4. **Extend the audit-event + correlation-id pattern** to every new module (Workspaces membership/role changes, invites, approvals).
5. Keep the **dist-emit build model**; don't reintroduce source consumption.
6. Resolve the standing security items (**key length, CSRF decision, Redis throttler storage**) before the production cutover — they don't block *implementation* but block *sign-off*.
