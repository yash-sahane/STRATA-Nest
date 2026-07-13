# On-Call Runbook

First-responder playbook. Correlate everything by `X-Request-Id` (in every log line
and response header).

## Triage order
1. `GET /api/v1/health` on each api replica. `degraded` → check `db`/`redis` field.
2. Recent error logs filtered by `X-Request-Id` / route.
3. Queue depth + failed set (worker).
4. Upstream: Postgres/Redis availability, nginx routing.

## Symptom → likely cause → action
| Symptom | Likely cause | Action |
|---|---|---|
| 401 storm on protected routes | JWT secret mismatch / clock skew / cookie `Secure` vs http | verify secrets, NTP, `JWT_COOKIE_SECURE` vs TLS termination |
| 429 storm | throttle limits or Redis limiter | check Redis(0); limiter **fails open** on Redis loss (allows) — expect fewer 429s if Redis is down |
| Health `degraded: redis:false` | Redis outage | app still serves (fail-open throttle, queue producers warn); restore Redis; realtime fan-out + queues resume |
| Health `degraded: db:false` | Postgres outage/failover | Prisma reconnects; expect 5xx until pg back; check pool |
| Emails not arriving | queue stuck / no worker / Resend down | check worker up + `email` queue; `EMAIL_TRANSPORT=inline` fallback logs; Resend status |
| Webhooks 401 | wrong `webhookSecret` / signature | confirm provider secret matches integration; check raw-body path |
| Realtime not updating | collection not broadcasting / WS auth | confirm collection in `MODEL_COLLECTION`; check cookie auth on connect |
| Integration token errors in prod | missing enc key | app should not have booted; verify `INTEGRATION_TOKEN_ENC_KEY` |
| Rising memory on api | WS registry / leak | check connection count; restart replica; capture heap for follow-up |
| Job failures piling up | downstream error, **no DLQ** | inspect failed set, fix root cause, requeue |

## Escalation
- Data integrity risk (bad `bulk-save` tree, balance miscompute) → page backend lead; consider a rollback (ROLLBACK.md).
- Security (token leak, auth bypass) → INCIDENT_RESPONSE.md, rotate secrets.

## Fast levers
- Redeploy the previous image tag or revert a config flag (ROLLBACK.md).
- `EMAIL_TRANSPORT=inline` to bypass a broken queue.
- Scale api replicas (limits stay correct via Redis).
