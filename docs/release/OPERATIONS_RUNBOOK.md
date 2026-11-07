# Operations Runbook

Day-2 operations for the NestJS API + worker.

## Services & dependencies
| Service | Role | Depends on | Scale |
|---|---|---|---|
| api | HTTP + WS | Postgres, Redis(0/2) | horizontal (≥2) |
| worker | email + git queues | Postgres, Redis(1) | horizontal (idempotent) |
| Postgres | data | — | primary + replica |
| Redis | cache/throttle(0), queue(1), socket(2) | — | HA/cluster |
| nginx | routes to api | api | — |

## Routine checks
- `GET /api/v1/health` per api replica → `status:ok`, `db:true`, `redis:true`.
- Worker log shows heartbeat (30s) + `email/git processor listening`.
- Queue depth (BullMQ) trending to zero; failed set not growing.
- Error rate / P95 (once metrics land — OBSERVABILITY.md).

## Common tasks
- **Scale api:** add replicas; rate limits are shared via Redis, so limits stay correct.
- **Drain a node:** SIGTERM → `tini` → shutdown hooks close queues/redis; in-flight WS drop and reconnect.
- **Rotate JWT secret:** deploy new `JWT_ACCESS_SECRET`; access tokens expire in `JWT_ACCESS_TTL` (default 15m); refresh continues. Rotate refresh secret only during a maintenance window (invalidates sessions).
- **Rotate `INTEGRATION_TOKEN_ENC_KEY`:** re-encrypt rows with a key-wrap migration; `TokenCipher.decrypt` tolerates the old prefix during transition.
- **Requeue failed jobs:** inspect BullMQ failed set (kept, `removeOnFail:false`); requeue after fixing root cause. **No DLQ yet** — triage manually.

## Config flags (operational levers)
`RBAC_ENFORCED` (per-permission vs membership floor),
`EMAIL_TRANSPORT` (queue|inline fallback), `STORAGE_DRIVER`,
`SWAGGER_ENABLED`, `METRICS_ENABLED`. All parsed strictly (`false` = false).

## Known operational gaps (track)
- No metrics/tracing yet (logs only) — OBSERVABILITY.md.
- No DLQ / job-failure alert.
- No worker readiness probe.
- ESLint not configured (code-quality gate absent).
