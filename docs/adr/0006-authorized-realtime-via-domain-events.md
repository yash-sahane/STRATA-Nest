# ADR-0006 — Authorized realtime rooms via domain events

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Security

## Context
A naive realtime layer — one that broadcasts every model change to collection-wide groups **any authenticated user may join** — leaks data across workspaces (a PII risk). It must also never fire **before the transaction commits** (or it emits phantom events on rollback), and its payloads must not diverge from the REST shape. Realtime therefore has to be authorized, post-commit, and shape-consistent with REST.

## Decision
Emit **explicit, business-meaningful domain events** (no generic `*Updated`) from services **after commit**. A `RealtimeSubscriber` translates those events into **workspace-authorized WebSocket rooms** — a socket's subscription is validated against ACTIVE membership before it joins. Payloads are built from the same Response DTOs, so realtime and REST shapes match. Public channel names and the WS frame follow the frozen contract (ADR-0003).

## Consequences
- (+) No cross-workspace leak; no phantom events on rollback; realtime payloads match REST.
- (+) Decouples modules — reactions go through events, not imports.
- (−) More explicit wiring than one catch-all receiver — accepted; the explicitness is the point.
- Multi-instance fan-out is handled by Redis pub/sub on a dedicated broadcast channel.

## Alternatives considered
- **A global signal with a filter:** rejected — still implicit, still easy to mis-scope.
- **Per-id channels only:** rejected — the frontend also needs collection-level invalidation.
