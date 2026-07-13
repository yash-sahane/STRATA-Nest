# ADR-0002 — Preserve 20-char string primary keys

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer

## Context
Every domain model uses a **20-char alphanumeric string primary key** generated in the application, not a UUID or auto-increment. These IDs thread through the whole stack: they are embedded in stored soft-FK strings across tables, the frontend's TanStack Query cache keys, collection slugs, and per-entity WebSocket channels.

## Decision
Use `id String @id` with an **application-generated 20-char alphanumeric default**. No UUID/int.

## Consequences
- (+) One ID shape everywhere — soft-FK strings, frontend cache keys, slugs, and WS channels all key off the same value; nothing needs a parallel numeric key.
- (+) IDs remain short, opaque, URL-safe.
- (−) Non-sequential PKs have worse index locality than bigint — accepted; `createdAt` indexes cover ordering.
- `generateId()` in `packages/common` has a unit test asserting the ID format (alphabet, length, uniqueness).

## Alternatives considered
- **UUIDv7 / int IDs:** rejected — a different ID shape would ripple through every soft-FK string, cache key, slug, and channel for no contract benefit.
