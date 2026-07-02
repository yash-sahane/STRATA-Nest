# Phase 0 — Foundations (Scaffold, Infrastructure, Contract Harness)

**Status: ✅ Done & verified.** Retrospective DoD.

## Goal
Stand up a buildable, type-safe NestJS monorepo with the frozen-contract primitives and the parity test harness — **no domain logic** — so every later phase inherits correct foundations.

## Scope
- pnpm/turborepo monorepo (`apps/api`, `apps/worker`, `packages/*`).
- `@lt/common` (byte-parity `generateId`, error+pagination envelopes, allowlisted query parser), `@lt/config` (Zod fail-fast env), `@lt/shared` (contract types, collection slugs, base event), `@lt/prisma` (datasource/generator + PrismaService/Module, introspect-first).
- `apps/api` bootstrap (`/api/v1`, cookie/helmet/CORS, ValidationPipe, exception filter, Swagger, `/api/v1/health`).
- `apps/worker` standalone BullMQ host (heartbeat, no processors).
- `infra/` Docker (api/worker), compose (pg/redis/api/worker/nginx), nginx WS upgrade.
- `@lt/contract-tests` harness; ADRs 0001–0012; Phase 0 guide.

## Out of Scope
- Any domain module, business rule, or Prisma domain model (only a removable `ScaffoldProbe`).
- Auth, RBAC, queues/processors, realtime gateway, migrations of real data.

## Deliverables
- All packages/apps compiling and emitting runnable `dist`.
- `@lt/common` unit tests (ID parity, query allowlist).
- Contract harness (error + pagination envelopes) runnable vs Django/Nest.
- Docs: [ARCHITECTURE](../TARGET_ARCHITECTURE_NESTJS.md), [AUDIT](../CURRENT_SYSTEM_AUDIT.md), [MATRIX](../MIGRATION_MATRIX.md), [ADRs](adr/… → ../adr), [PHASE_0_SCAFFOLD](../PHASE_0_SCAFFOLD.md).

## Acceptance Criteria
- [x] `pnpm install` succeeds.
- [x] `turbo run typecheck test` green for all projects (18/18 tasks).
- [x] `@lt/common` tests 16/16 (ID byte-parity + operator allowlist).
- [x] `turbo run build` emits clean `apps/api/dist/main.js` + `apps/worker/dist/main.js`.
- [x] Runtime smoke: `node dist/main.js` resolves `@lt/*` and fails fast on missing env.
- [x] Contract harness runs (no-ops with warning when target API is down).
- [x] 12 ADRs recorded.

## Rollback Strategy
Additive only — the entire monorepo lives beside the untouched `backend/` (Django) and `frontend/`. Rollback = delete `apps/`, `packages/`, `infra/`, root monorepo config. Zero impact on the running system.

## Risks
- **ID scheme drift** → mitigated by the byte-parity unit test (ADR-0002).
- **Monorepo build/resolution complexity** → resolved by packages emitting `dist`, apps resolving via `node_modules` (verified end-to-end).
