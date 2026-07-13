# ADR-0003 — Freeze the v1 REST/WS contract

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer, Frontend Lead

## Context
The Next.js frontend hard-codes the wire contract: camelCase fields, the `{items,total,page,pageSize}` pagination envelope, the `{error:{message,code,type}}` error envelope, cookie names `strata_access`/`strata_refresh`, the collection slugs (`frontend/src/lib/api/collection-slugs.ts`), and the WS frame `{event,payload,channels,timestamp}`. The generic query filter's operators are also relied upon.

## Decision
Treat the **v1 contract as frozen.** The API holds every envelope, field name, cookie, slug, and WS frame stable. Behavior may improve (correctness, auth, integrity) but **shapes do not change** under `/api/v1`. Any breaking shape goes to a future `/api/v2`.

## Consequences
- (+) The frontend does not change shape when the backend evolves within v1.
- (+) Contract tests lock the wire shapes and catch accidental drift.
- (−) Some quirks (snake↔camel per-field mapping, a generic filter) must be implemented carefully; the query filter uses a per-resource allowlist without changing the request shape.
- A contract test suite is generated from `frontend/src/lib/api/*` to guard the v1 shape.

## Alternatives considered
- **Redesign the API cleanly:** rejected for v1 — it would force a synchronized frontend rewrite in the same release.

