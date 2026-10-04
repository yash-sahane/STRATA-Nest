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
Node 20, pnpm 10, Docker.

## Quickstart — everything in containers
```bash
cp .env.example .env   # then edit — see packages/config/src/env.schema.ts
pnpm install           # only for the `pnpm stack:*` shortcuts; the images install their own
pnpm stack:up          # build images, migrate + seed the database, start, wait until healthy
```
Postgres, Redis, a one-shot `migrate` job, the API, the worker, the frontend and nginx.
`pnpm stack:ps` shows them, `pnpm stack:logs` follows them, `pnpm stack:down` stops them
(the database volume is kept).

## Quickstart — apps on the host, database in containers
```bash
pnpm install           # also generates the Prisma client (@strata/prisma's postinstall)
cp .env.example .env
pnpm db:up             # Postgres on localhost:5433, Redis on localhost:6379
pnpm db:migrate        # create / update the schema
pnpm db:seed           # admin account (+ one account per role outside production)
pnpm dev               # api + worker + frontend, with reload
```
Either way the frontend serves on `http://localhost:3000` and the API on
`http://localhost:8000/api/v1` (Swagger at `/api/docs` outside production).

Run one or the other, not both at once: they bind the same ports.

### Seeded accounts
| Account | Password | |
|---|---|---|
| `admin@strata.local` | `ChangeMe123!` | superuser; override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` |
| `role.<role>@strata.local` | `RolePass123!` | one per workspace role, used by `e2e/`. Never created when `NODE_ENV=production`; turn off elsewhere with `SEED_TEST_ACCOUNTS=false` |

## Common commands
```bash
pnpm build            # build every workspace package (dependency order)
pnpm typecheck        # typecheck everything
pnpm lint             # eslint everything
pnpm test             # unit suites
pnpm test:e2e         # browser regression suite — needs the running stack
pnpm test:contract    # wire-contract suite — skips when the API is down

pnpm db:status        # which migrations are applied
pnpm db:reset         # DESTROYS the database volume, then migrates and seeds a fresh one
pnpm prisma:validate  # check the schema
```
Prisma commands go through `packages/prisma/scripts/prisma.cjs`, which supplies the two
things each of them needs here: the schema is a folder (`--schema=schema`), and
`DATABASE_URL` lives in the repo-root `.env`. Calling `prisma` directly finds neither.

### Dependencies
pnpm's default isolated `node_modules` is used on purpose: a package can import only what
its own `package.json` declares. If an import resolves on your machine but not in CI or
Docker, the dependency is missing from that package's manifest — add it there rather
than hoisting.

## Configuration
All env is validated at boot by `@strata/config`. In **production** the app refuses
to start without strong JWT secrets (≥32 chars), a token-encryption key (≥32), and
`JWT_COOKIE_SECURE=true`. Booleans use explicit parsing (`false`/`0` = false).

## Key docs
- Architecture: [docs/ARCHITECTURE_SUMMARY.md](docs/ARCHITECTURE_SUMMARY.md), [docs/adr/](docs/adr/)
- Operations: `docs/release/{DEPLOYMENT,OPERATIONS_RUNBOOK,ONCALL_RUNBOOK,ROLLBACK,DISASTER_RECOVERY,INCIDENT_RESPONSE}.md`

## License / ownership
Internal.
