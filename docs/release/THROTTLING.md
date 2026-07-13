# Throttling

**Status: IMPLEMENTED + unit-verified + DI-verified + LIVE-VERIFIED (single
instance). Multi-instance behavior NOT EXECUTED (needs ≥2 replicas).**

## Live verification this sprint
Running against a real Redis, real login requests returned genuine, live
`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers that
correctly decremented across requests, and a real `429 Too Many Requests` (with
`Retry-After`) was observed once the login limit (5/min) was actually
exhausted by repeated e2e test requests — this was not simulated, it was the
real limiter firing under real (if modest) load.

## Problem
`ThrottlerModule.forRoot` used the default **in-memory** store. With >1 API
replica, each pod counts independently → effective limit = configured × replicas,
and counters reset on restart. Login/reset brute-force protection was per-pod.

## Fix
- New `RedisThrottlerStorage` (`apps/api/src/throttling/redis-throttler.storage.ts`)
 implements `@nestjs/throttler`'s `ThrottlerStorage` interface backed by the
 shared `REDIS_CLIENT` (ioredis).
- Wired via `ThrottlerModule.forRootAsync` injecting `REDIS_CLIENT`
 (`app.module.ts`). DI graph resolves (boot reaches DB connect).
- **Atomic** increment: one Lua script does `INCR` + `PEXPIRE` + block accounting
 per request — no read-modify-write race across replicas.
- **Unit conventions honored:** `ttl`/`blockDuration` are milliseconds in
 throttler v6; `timeToExpire`/`timeToBlockExpire` returned in seconds.
- **Fail-open:** if Redis is unreachable the request is allowed and a warning is
 logged — a limiter outage must not take the API down (availability > strict limiting).

## Keys
`throttle:<throttlerName>:<tracker>` (counter) and
`throttle:block:<throttlerName>:<tracker>` (block flag). Tracker is client IP,
or IP+email for password-reset (`AuthThrottlerGuard.getTracker`, honors XFF).

## Limits (env-configurable; TTLs seconds → ms internally)
| Route class | Limit | Window |
|---|---|---|
| default | 120 | 60s |
| login | 5 | 60s |
| refresh | 20 | 60s |
| register | 3 | 3600s |
| password-reset | 3 (per IP+email) | 3600s |

## Tests
`apps/api/src/throttling/redis-throttler.storage.spec.ts` (3): ms→s mapping,
blocked-when-over-limit, fail-open on Redis error.

## NOT verified (needs live infra)
- ❓ Two API replicas sharing one Redis enforce a **single** global limit — run
 2 instances behind nginx and hammer login; expect the 6th request in 60s to 429
 regardless of which pod serves it.
- ❓ Behavior on Redis failover (fail-open confirmed only in unit).
- ❓ Cache DB (db 0) key volume under production traffic — consider a dedicated DB/prefix.
