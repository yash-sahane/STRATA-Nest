# ADR-0006 — Authorized realtime rooms via domain events

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Security

## Context
Realtime today is a global `post_save`/`post_delete` signal that broadcasts **every** model with a `REALTIME_COLLECTION` attribute to collection-wide groups **any authenticated user may join** — a cross-workspace data/PII leak (A§7, D2). Payloads drop relations and diverge from the REST shape, and the broadcast fires **pre-commit** (D10).

## Decision
Replace the global signal with **explicit, business-meaningful domain events** (no generic `*Updated`) emitted by services **after commit**. A `RealtimeSubscriber` translates events into **workspace-authorized Socket.IO rooms** (subscriptions validated against ACTIVE membership before a socket joins). Payloads are built from the same Response DTOs (consistent shape). Public channel names and the WS frame stay unchanged (ADR-0003).

## Consequences
- (+) Closes the cross-workspace leak (D2); fixes phantom events and payload divergence (D10).
- (+) Decouples modules — reactions go through events, not imports (A§11.1).
- (−) More explicit wiring than a single magic receiver — accepted as the point of the change.
- Follow-up: Socket.IO Redis adapter for multi-instance fan-out (logical DB2, ADR-0007 context).

## Alternatives considered
- **Keep global signals, add a filter:** rejected — still implicit, still easy to mis-scope.
- **Per-id channels only:** rejected — frontend also needs collection-level invalidation (A§7.1).

## Traceability
A§7, A§11.1, D2, D10 · §9, §11, M§6.1, M§7
