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

### Demo data
```bash
pnpm demo:data              # builds a "Demo Company" workspace; does nothing if it exists
pnpm demo:data -- --reset   # deletes it and builds it again
```
Three projects, requirements, epics, sprints (one finished, one running, one planned), 25
tasks across every status, comments, dependencies, attendance history, leave requests and
time entries in every state — created through the API, so it obeys the same rules a user
does. All seven `role.*` accounts are members with the role in their name, so signing in as
any of them shows the same workspace from that role's point of view. Needs the stack
running. `DEMO_WORKSPACE_NAME="QA Sandbox" pnpm demo:data` builds a second copy under
another name, for tests that destroy things.

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

A clean install is the only real test of this: pnpm does not prune an existing
`node_modules`, so a package removed from a manifest keeps working on the machine that
removed it. Check dependency changes from a fresh checkout (`git worktree add`).

### Security audit
`pnpm audit --audit-level high` is a CI gate. Vulnerable **transitive** packages are moved
to their patched release with `pnpm.overrides` in the root `package.json`; every entry
names the vulnerable range and stays inside the major already in use.

Known and deliberately left:

| Advisory | Why it is still there |
|---|---|
| `braces` GHSA-vfj7-8cjw-p6xm (high) | No patched release exists. Development tooling only (jest, typescript-eslint, the Nest CLI) — absent from every production dependency closure — so it is listed in `pnpm.auditConfig.ignoreGhsas`. Remove that entry when a fix ships. |
| `@nestjs/core` GHSA-36xv-jgw5-4q75 (moderate) | Fixed only in Nest 11. Needs the framework's major upgrade. |
| `file-type` (moderate, 2) | Fixed only in v21, a major. Reached through `@nestjs/common`'s `FileTypeValidator`, which the API does not use. |
| `glob`, `minimatch` (moderate) | Fixed only in new majors (glob 14, minimatch 11). Development tooling only: the Nest CLI and typescript-eslint. |
| `deepmerge` (low) | No patched release exists. Development tooling only (jest, the Nest CLI). |

## Configuration
All env is validated at boot by `@strata/config`. In **production** the app refuses
to start without strong JWT secrets (≥32 chars), a token-encryption key (≥32), and
`JWT_COOKIE_SECURE=true`. Booleans use explicit parsing (`false`/`0` = false).

## Key docs
- Architecture: [docs/ARCHITECTURE_SUMMARY.md](docs/ARCHITECTURE_SUMMARY.md), [docs/adr/](docs/adr/)
- Operations: `docs/release/{DEPLOYMENT,OPERATIONS_RUNBOOK,ONCALL_RUNBOOK,ROLLBACK,DISASTER_RECOVERY,INCIDENT_RESPONSE}.md`

## License / ownership
Internal.
