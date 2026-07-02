# Phase 7 — Realtime Gateway + Event Bus

**Status: 🚧 Implemented + unit-verified; live gate pending a DB+Redis+frontend environment.**
Done: **raw-WebSocket** gateway at `/ws/collections/` (the frontend uses native `WebSocket`, not Socket.IO — chosen for contract parity, ADR-0003); cookie auth on connect (anonymous → close 4401); permissive subscribe with **broadcast-time workspace filtering** (`RealtimeService.canReceive` — **closes D2**, unit-tested); central **Prisma write hook** (`$use`) emits `<collection>.<create|update|delete>` frames (replaces the Django signal firehose); **Redis pub/sub** cross-instance fan-out (instance-id dedup); `RealtimeSubscriber` bridges business events (member-added, invitation-accepted, join-approved, sprint-completed). Typecheck + DI graph green; 5 realtime unit tests.
**Deviations/deferrals (documented):** raw WS instead of Socket.IO (contract parity); payload is best-effort (frontend refetches, A§7.1); **commit-gating** for the few transactional writes is a follow-up (the write hook fires per-op, so a rolled-back transaction could emit — low risk); membership set is cached per socket at connect.

## Goal
Replace the global Django-signal firehose with an **authorized** Socket.IO gateway fed by domain events, fixing the cross-workspace leak (A§7, D2) while preserving the WS frame contract (ADR-0003, ADR-0006).

## Scope
- `RealtimeModule`: Socket.IO gateway + `@socket.io/redis-adapter` (logical DB2).
- Cookie-auth Socket.IO middleware (`lt_access`), anonymous → disconnect.
- **Room authorization**: a socket may only join a collection/entity channel for workspaces it is an ACTIVE member of.
- `RealtimeSubscriber` translating the domain events already emitted in Phases 1–6 into rooms; payloads from Response DTOs; **commit-gated** (D10).

## Out of Scope
- New event types (all events were defined with their modules).
- Notification/audit persistence (Phase 9 subscribers).

## Deliverables
- Gateway + adapter + auth middleware; subscribe/unsubscribe with authorization.
- `RealtimeSubscriber`; frame `{event,payload,channels,timestamp}` preserved.
- Contract tests for WS frames + an authorization test proving no cross-workspace leakage.

## Acceptance Criteria
- [ ] Frontend `realtime-client.ts` works unchanged (same channels, same frame shape).
- [ ] A user cannot receive events for a workspace they don't belong to (explicit test) — closes D2.
- [ ] No event is emitted on a rolled-back transaction (commit-gated) — closes D10.
- [ ] Multi-instance fan-out verified via Redis adapter.

## Rollback Strategy
The gateway runs alongside Django Channels; the frontend WS URL can point at either via env/nginx. Revert = route `/ws/` back to Daphne. No DB change. Events keep emitting harmlessly if the subscriber is disabled.

## Risks
- **Channel-name/room mapping mismatch** → contract tests assert exact channel names; keep public names identical while scoping internally.
- **Reconnect/backoff behavior** already in the client → verify against the new gateway under drops.
