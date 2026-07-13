# Chaos Test Plan

**Status: PLAN. NOT EXECUTED (no running stack).** Each scenario lists the
injection, the **expected** graceful behavior (from code inspection), and the
pass criterion to verify live.

| # | Fault | Injection | Expected behavior (design) | Pass criterion |
|---|---|---|---|---|
| 1 | **Redis down** | stop redis | Throttler **fails open** (RedisThrottlerStorage catch → allow + warn); refresh-store/queue producers degrade with warnings; health → `degraded` | API keeps serving reads/writes; `/health` shows `redis:false`; no crash |
| 2 | **Postgres restart** | restart pg | In-flight queries error; Prisma reconnects | Requests recover after pg is back; no permanent 500s; pool re-establishes |
| 3 | **Worker restart** | kill worker | BullMQ jobs remain in queue; `tini`→SIGTERM→`worker.close()` drains in-flight | On restart, pending email/git jobs process; no dupes (idempotency keys) |
| 4 | **API restart** | kill api pod | `enableShutdownHooks` closes queues/redis; WS sockets drop | Clients reconnect WS; no orphaned resources; rolling restart = zero downtime with ≥2 replicas |
| 5 | **Queue failure** | break queue Redis | Producers log + (email) fall back to inline log; jobs retry w/ backoff | No request fails due to queue; jobs resume when Redis returns |
| 6 | **Expired/invalid JWT** | tamper/expire cookie | `JwtAuthGuard` 401; refresh rotates or 401 | Protected routes 401; no stack leak; refresh-reuse rejected (strict mode) |
| 7 | **Network latency** | tc/toxiproxy 300ms | timeouts honored; correlation ids trace slow path | No cascading failure; P99 degrades gracefully |
| 8 | **Disk full** | fill volume | local StorageService write throws → 5xx on upload only | Non-upload paths unaffected; clear error; DB unaffected |
| 9 | **DB pool exhaustion** | flood concurrent | requests queue for a connection | No deadlock; requests complete or time out cleanly; tune `connection_limit` |
| 10 | **Large queue backlog** | enqueue 100k | worker drains at concurrency; memory bounded | No OOM; backlog shrinks; **note: no DLQ** — failures accumulate (see gap) |
| 11 | **WebSocket disconnect** | drop sockets | `handleDisconnect`→`registry.remove`; Redis fan-out unaffected | No registry leak; memory flat over churn |
| 12 | **Node crash** | `process.exit` | orchestrator restarts; shutdown hooks may be skipped | Supervised restart; queue idempotency prevents double-processing |

## Known resilience gaps to validate/close
- **No DLQ / no alerting** on repeated job failure (scenario 10) — failures pile up silently. Add before high queue volume.
- **Worker readiness probe** absent (scenario 3/4) — orchestrator can't distinguish "starting" from "wedged".
- **Fail-open throttler** (scenario 1) trades protection for availability — accept consciously.

## Tooling
`toxiproxy` (latency/partition), `pumba`/`docker kill` (restarts), `stress-ng`/`fallocate` (disk/CPU), a BullMQ seed script (backlog). Run against staging; record actual recovery times.
