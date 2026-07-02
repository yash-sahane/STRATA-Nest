# Phase 0 — Scaffold, Infrastructure & Contract Harness

This documents the Phase 0 deliverable (Migration Order Matrix M§9, phase 0). It is **infrastructure only** — there are **no domain modules or business logic** yet, by design. Domain work begins in Phase 1 (Auth/Users) only after this foundation is in place.

## What exists

```
apps/
  api/      NestJS HTTP bootstrap: /api/v1 prefix, cookie-parser, helmet, CORS(credentials),
            global ValidationPipe + AllExceptionsFilter, Swagger at /api/docs, /api/v1/health (DB+Redis)
  worker/   Standalone BullMQ host (no HTTP): config + Redis heartbeat, zero processors
packages/
  common/   generateId (Django byte-parity, ADR-0002) + parity tests,
            AllExceptionsFilter (frozen error envelope), paginate() (frozen envelope),
            parseListQuery (allowlisted CamelCaseQueryFilter, closes D11) + tests
  config/   Zod-validated env (fail-fast), redis/cors helpers
  shared/   split contract types / constants (collection slugs) / base DomainEvent / types
  prisma/   datasource+generator only; PrismaService + PrismaModule; introspect-first (ADR-0010)
  contract-tests/  frozen-contract parity harness (runs vs Django now, vs NestJS later)
infra/
  docker/   Dockerfile.api, Dockerfile.worker, docker-compose (postgres/redis/api/worker/nginx)
  nginx/    reverse proxy + WebSocket upgrade
docs/adr/   12 ADRs recording the major decisions
```

## First-run

```bash
pnpm install
cp .env.example .env                     # fill secrets

# Prisma: introspect the EXISTING Postgres, then generate the client (ADR-0010)
pnpm prisma:pull
pnpm prisma:generate

# Build once so apps resolve the workspace packages from their dist
pnpm build                               # turbo: builds packages in dependency order

# Verify the scaffold (no DB needed for these unit tests)
pnpm exec turbo run typecheck test       # typecheck all + @lt/common unit tests

# Run
pnpm --filter @lt/api dev                # http://localhost:8000/api/v1/health , /api/docs
pnpm --filter @lt/worker dev

# Or the whole stack
docker compose -f infra/docker/docker-compose.yml up --build
```

## Deliberately absent in Phase 0 (added later per M§9)
- Any domain module (auth, workspaces, tasks, …) and business rules.
- Prisma domain models (introspected/refined per module; string PKs preserved — ADR-0002).
- BullMQ queues/processors, realtime gateway, RBAC guards, application services.
- ESLint config wiring (lint scripts are placeholders until a shared config lands).

## Guardrails already enforced
- **Frozen contract** primitives (error/pagination envelopes, collection slugs) live in code now, so every ported module inherits them (ADR-0003).
- **ID byte-parity** is unit-tested before any data flows (ADR-0002).
- **Allowlisted filtering** replaces arbitrary-field filtering from day one (D11).
- **Config is fail-fast** — a bad env aborts boot with a clear message.
