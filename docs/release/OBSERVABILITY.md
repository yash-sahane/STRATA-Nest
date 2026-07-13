# Observability

**Status: PARTIAL. Structured logging + correlation IDs + health checks EXIST and
are verified. Metrics/tracing/dashboards are NOT IMPLEMENTED (documented plan +
config seam only).** I did not fabricate a metrics stack that cannot be run here.

## Implemented + verified (by inspection)
- **Structured logging:** `nestjs-pino` JSON logs; level via `LOG_LEVEL`.
- **Correlation IDs:** `X-Request-Id` honored inbound, generated if absent, echoed on the response (`app.module.ts` `genReqId`).
- **Secret redaction:** authorization/cookie/set-cookie/password fields removed from logs.
- **Health:** `GET /api/v1/health` → `{status, db, redis, ts}` (active Postgres + Redis checks).
- **Worker heartbeat:** 30s liveness log against the queue Redis DB.
- **Queue events:** `completed`/`failed`/`error` logged by EmailProcessor + GitProcessor (job id, attempts, error).

## NOT implemented — plan
A `METRICS_ENABLED` env flag was added as the seam. To complete:

1. **Prometheus metrics** — add `prom-client`; expose `GET /metrics` (guarded by `METRICS_ENABLED`, `@Public`, and network policy). Default process metrics + custom:
 - `http_request_duration_seconds` histogram (method, route, status) via an interceptor.
 - `bullmq_jobs_total{queue,status}`, `bullmq_job_duration_seconds` from Worker events.
 - `realtime_connections` gauge, `realtime_frames_total{collection}` from `SocketRegistry`/`RealtimeService`.
 - `db_query_duration_seconds` via a Prisma `$on('query')` (sampled).
2. **Tracing** — `@opentelemetry/sdk-node` + auto-instrumentations (HTTP, ioredis, pg/Prisma); export OTLP to a collector; propagate the correlation id as the trace/span baggage.
3. **Dashboards** — Grafana: request latency (P50/95/99), error rate, queue depth/throughput/failures, WS connections, DB pool saturation, Redis ops. Alerts: 5xx rate, queue backlog, health `degraded`, worker heartbeat gap.

## Rationale for not implementing now
Metrics/tracing are only meaningful when scraped/collected against a running
system under traffic, which this environment cannot provide. Shipping unexercised
instrumentation would add risk without evidence. The flag + plan let the team land
it behind a scrape target with a load test to validate.

## NOT verified
- ❓ Metrics endpoint, trace export, dashboards, alert routing (none exist yet).
