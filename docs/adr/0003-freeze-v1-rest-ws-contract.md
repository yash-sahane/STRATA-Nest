# ADR-0003 — Freeze the v1 REST/WS contract

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer, Frontend Lead

## Context
The Next.js frontend is staying. It hard-codes the wire contract (A§13): camelCase fields, the `{items,total,page,pageSize}` pagination envelope, the `{error:{message,code,type}}` error envelope, cookie names `lt_access`/`lt_refresh`, the collection slugs (`frontend/src/lib/api/collection-slugs.ts`), and the WS frame `{event,payload,channels,timestamp}`. The generic query filter's operators are also relied upon (A§4.3).

## Decision
Treat the **v1 contract as frozen.** NestJS reproduces every envelope, field name, cookie, slug, and WS frame exactly. Behavior may improve (correctness, auth, integrity) but **shapes do not change** under `/api/v1`. Any breaking shape goes to a future `/api/v2`.

## Consequences
- (+) Zero frontend rewrite for the migration; enables strangler cutover per module (ADR-0010).
- (+) Contract tests become the migration's safety net (§19).
- (−) Some legacy quirks (snake↔camel per-field mapping, generic filter) must be re-implemented faithfully — accepted; the query filter gains a per-resource allowlist without changing the request shape (closes D11 without breaking callers).
- Follow-up: generate a frozen-contract test suite from `frontend/src/lib/api/*` in Phase 0.

## Alternatives considered
- **Redesign the API cleanly:** rejected for v1 — would force a synchronized frontend rewrite and a big-bang cutover.

## Traceability
A§4.3, A§7, A§13 · §8, §9, §19, M§3
