# CI Pipeline

**Status: PIPELINE ADDED (`.github/workflows/ci.yml`). NOT EXECUTED — no runner
in this environment; first real run happens on push/PR.**

## Jobs
1. **verify** (fail-fast): install (frozen lockfile) → prisma generate → `turbo run typecheck` → lint (non-blocking, see gap) → `turbo run test --coverage` → `turbo run build`. Postgres 16 + Redis 7 service containers are provisioned so e2e/contract jobs can be enabled here later (currently `if: false`).
2. **security**: `pnpm audit --audit-level high` + `actions/dependency-review-action` (PRs).
3. **docker**: buildx build of `Dockerfile.api` and `Dockerfile.worker` with GHA layer cache (no push).

Concurrency cancels superseded runs; Turbo cache accelerates typecheck/build/test.

## Local equivalent (what WAS executed this sprint)
- `pnpm exec turbo run typecheck test` → **20/20 tasks green** (api 133, worker 7, common 16, contract 5 + 1 skipped).
- Coverage measured this run.
- DI smoke boots for api + worker.

## KNOWN GAP — ESLint not configured
`eslint` is **not a dependency** in this repo and there is **no ESLint config**;
`pnpm --filter … run lint` fails with "eslint not found" for every package.
The CI `Lint` step is therefore `continue-on-error: true` until a flat config +
`eslint` + `typescript-eslint` are added. **This is a real gap** — do not treat
"CI green" as "linted" until this is resolved.

## Before first green run (todo for the team)
- Provide repo secrets if pushing images.
- Confirm `pnpm audit` baseline (may surface transitive advisories → triage).
- Enable the e2e job once `DATABASE_URL` points at a migrated schema.
- Add a contract-compliance job once a running reference environment is available to run it against.
