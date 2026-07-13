# Architecture Summary

The canonical overview of the STRATA backend. Stack: **Next.js** frontend
on a **NestJS + Prisma + PostgreSQL + Redis + BullMQ** monorepo.

## Topology
```
Next.js frontend ──HTTP/WS──▶ apps/api (NestJS)
 │ Prisma
 ▼
 PostgreSQL ◀── owned by packages/prisma migrations
 ▲
apps/worker (BullMQ) ────────────┘ Redis (cache DB0 / queue DB1 / socket DB2)
```

- **apps/api** — HTTP controllers + a raw WebSocket gateway (not Socket.IO).
 Controller → Service → Prisma (repository optional, ADR-0004).
- **apps/worker** — BullMQ consumers (email, git). No HTTP surface.
- **packages/prisma** — the single owner of the database schema (migrations under
 `packages/prisma/migrations`). Run `prisma migrate deploy` to stand it up.
- **packages/config** — one env schema, validated fail-fast at boot.
- **packages/common** — http/date/id primitives + the global exception filter.
- **packages/shared** — domain events, queue contracts, wire types.
- **packages/contract-tests** — regression suite that locks the frozen wire
 contract against a running API (skips when unreachable).

## Domain modules (apps/api/src/modules)
auth · authz (RBAC) · users · workspaces · projects · requirements · epics ·
sprints · tasks · attendance · leave · time-tracking · notifications · activity ·
files · storage · integrations · generation · email · realtime · deletion.

## Cross-cutting architecture (see ADRs)
- **Modular monolith**, API/worker split — ADR-0001.
- **String primary keys** (20-char) preserved — ADR-0002.
- **Frozen v1 REST/WS contract** — ADR-0003. Pagination `{items,total,page,pageSize}`;
 error `{error:{message,code,type}}`; cookie JWT `strata_access`/`strata_refresh`; WS frame
 `{event,payload,channels,timestamp}`; camelCase; ISO dates with 6-digit microseconds.
- **Policy-based RBAC** with normalized permissions — ADR-0005.
- **Authorized realtime** via domain events (workspace-scoped rooms) — ADR-0006.
- **BullMQ async, commit-then-emit** (no side effects inside the DB transaction) — ADR-0007.
- **Cookie JWT** with server-tracked revocable refresh tokens — ADR-0009.
- **Application Services** orchestrate cross-module work (e.g. deletion) — ADR-0012.

## Delete semantics
Two-zone deletion: Zone 1 is a Prisma `$transaction` that removes child rows
before parents (application-level cascade, since `deleteMany` bypasses the write
hook); Zone 2 runs post-commit side effects (blob cleanup, realtime frames, queue
purge). HR/audit rows are snapshotted to an internal `retention_archive` before
deletion. DB foreign keys (NO ACTION) are the integrity backstop.

## Security
pbkdf2 password hashing (`pbkdf2_sha256$…`), cookie-based JWT with revocable
refresh, Redis-backed rate limiting, integration tokens encrypted at rest
(write-only), production env hard-gates (≥32-char secrets, Secure cookies).

## Operations
See `docs/release/` for deployment, rollback, DR, backup, on-call, incident
response, observability, CI, and load/chaos plans.
