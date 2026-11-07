# Deployment

Deployment for the NestJS API + worker.

## Topology
`nginx` → routes `/api/v1/*`, `/ws/*`, and `integrations/*/webhook/*` to **Nest**
`api` (HTTP+WS, ≥2 replicas for HA), `worker` (BullMQ), **Postgres**,
**Redis** (logical DBs: 0 cache/throttle, 1 queue, 2 socket).

## Build & images
```bash
docker build -f infra/docker/Dockerfile.api -t strata/api:$(git rev-parse --short HEAD) .
docker build -f infra/docker/Dockerfile.worker -t strata/worker:$(git rev-parse --short HEAD) .
```
Images run **non-root** under `tini`. CI builds both (ci.yml `docker` job).

## Required production env (boot fails fast without these)
- `NODE_ENV=production`
- `DATABASE_URL`, `REDIS_HOST`/`REDIS_PORT`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (**≥32 chars**)
- `INTEGRATION_TOKEN_ENC_KEY` (**≥32 chars**, from a secret store)
- `JWT_COOKIE_SECURE=true`, `JWT_COOKIE_SAMESITE`, `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`
- `EMAIL_TRANSPORT=queue`, `RESEND_API_KEY`, `EMAIL_FROM`
- `STORAGE_DRIVER=local` + `STORAGE_LOCAL_ROOT` on a mounted, backed-up volume (no S3 driver is built: `s3` is refused at start-up)
- Optional: `SWAGGER_ENABLED` (default off in prod)

## Migrations (ordering matters)
1. Apply **additive** tables/columns first (backward compatible): `notifications_notificationdelivery`, `core_idempotencykey`. Guarded + reversible.
2. Run the **integration token encrypt-in-place** data migration and verify no plaintext remains.
3. No destructive schema change without a dedicated, reviewed migration — `packages/prisma` owns the schema.

## Rollout
1. Deploy worker first (idempotent consumers).
2. Deploy api (rolling; ≥2 replicas; readiness = `GET /api/v1/health`).
3. Health gate each step; watch logs/metrics. Rollback = redeploy previous image / revert config (see ROLLBACK.md).

## Health & readiness
- API: `GET /api/v1/health` → `{status:'ok'|'degraded', db, redis, ts}`. Use as readiness; process-up as liveness.
- Worker: no HTTP; use process supervision + heartbeat log. (Gap: no active worker readiness probe.)

## Post-deploy verification
Smoke: login → me → a scoped list → a realtime frame → enqueue an email →
webhook signature 202. Confirm no `degraded` health, no unhandled errors.
