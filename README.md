# STRATA

Enterprise project-management & HR platform: a **Next.js** frontend on a
**NestJS + Prisma + PostgreSQL + Redis + BullMQ** backend monorepo. Covers SCRUM
workflow, HR (attendance/leave), time tracking, integrations, and real-time
collaboration.

## Layout (pnpm workspace)
```
apps/
  frontend/ Next.js app (App Router)
  api/      NestJS HTTP + raw WebSocket gateway
  worker/   BullMQ consumers (email, git) — no HTTP
packages/
  common/   http/date/id primitives, exception filter
  config/   env schema + validation (fail-fast)
  shared/   domain events, queue contracts, wire types
  prisma/   Prisma schema + client (owns the database)
  testing/  test helpers
  contract-tests/  wire-contract regression suite (skips when the API is down)
infra/      docker/ (Dockerfiles, compose), nginx/, loadtest/ (k6)
docs/       architecture summary, ADRs, operations runbooks
```

## Prerequisites
Node 20, pnpm 10, Docker (for local Postgres/Redis).

## Quickstart (local)
```bash
pnpm install
cp .env.example .env   # then edit — see packages/config/src/env.schema.ts
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
pnpm --filter @strata/prisma run generate
pnpm --filter @strata/prisma exec prisma migrate deploy   # stand up the schema
pnpm run dev                                               # api + worker + frontend
```
The frontend serves on `http://localhost:3000`, the API on `http://localhost:8000/api/v1`.

## Common commands
```bash
pnpm run build        # build every workspace package (dependency order)
pnpm run typecheck    # typecheck everything
pnpm run test         # run the unit/integration suite
pnpm --filter @strata/api run test:e2e   # needs live Postgres + Redis
```

## Configuration
All env is validated at boot by `@strata/config`. In **production** the app refuses
to start without strong JWT secrets (≥32 chars), a token-encryption key (≥32), and
`JWT_COOKIE_SECURE=true`. Booleans use explicit parsing (`false`/`0` = false).

## Key docs
- Architecture: [docs/ARCHITECTURE_SUMMARY.md](docs/ARCHITECTURE_SUMMARY.md), [docs/adr/](docs/adr/)
- Operations: `docs/release/{DEPLOYMENT,OPERATIONS_RUNBOOK,ONCALL_RUNBOOK,ROLLBACK,DISASTER_RECOVERY,INCIDENT_RESPONSE}.md`

## License / ownership
Internal.
