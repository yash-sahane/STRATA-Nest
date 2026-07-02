# ADR-0002 — Preserve 20-char string primary keys

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer

## Context
Every Django model extends `TimestampedModel` whose PK is a **20-char `secrets.choice` alphanumeric string** generated in the app, not a UUID or auto-increment (A§4.1, A§9.1). These IDs are embedded in: stored soft-FK strings across tables (A§9.2), the frontend's TanStack Query cache keys, collection slugs, and WS per-entity channels (A§7, A§13).

## Decision
Keep the identity scheme **exactly**: Prisma `id String @id` with an **app-generated 20-char default** whose alphabet and length match the Django `generate_native_id()` byte-for-byte. No switch to UUID/int.

## Consequences
- (+) Existing data migrates verbatim; no rewrite of soft FKs; frontend caches stay valid.
- (+) IDs remain short, opaque, URL-safe.
- (−) Non-sequential PKs have worse index locality than bigint — accepted; `createdAt` indexes cover ordering (A§9.4).
- Follow-up: `generateId()` in `packages/common` must have a unit test asserting parity with the Django generator before any data flows.

## Alternatives considered
- **UUIDv7 / int IDs:** rejected — breaks every stored soft-FK string and every frontend cache key (A§13), with no contract benefit.

## Traceability
A§4.1, A§9.1, A§9.2, A§13 · §4, ADR-0003
