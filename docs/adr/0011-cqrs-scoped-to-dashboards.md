# ADR-0011 — CQRS scoped to read-heavy dashboards only

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect (per architecture review)

## Context
The product is fundamentally CRUD-shaped (A§1). Applying CQRS globally (separate command/query models everywhere) would multiply code for no benefit. But some surfaces — workspace analytics, sprint burndown, time/attendance summaries — are genuinely read-heavy and aggregate across many tables. No analytics engine exists today (A§12).

## Decision
**Do not** adopt CQRS system-wide. Commands and queries share the same services/Prisma models across the transactional domain. **Introduce read-side projections only for read-heavy dashboards/reports**, where the query aggregates broadly and the read pattern diverges from the write model. Such read models are Postgres materialized views or event-fed projection tables, invalidated via domain events (§11).

## Consequences
- (+) Dashboards stay fast without taxing the write path; no global complexity tax.
- (−) A small number of projections to maintain/invalidate — contained and event-driven.
- Follow-up: each projection documents its source events and refresh trigger.

## Alternatives considered
- **Global CQRS:** rejected — over-engineering for CRUD (review feedback).
- **Ad-hoc heavy queries on the write model:** rejected for dashboards — risks slow, lock-prone aggregate scans.

## Traceability
A§1, A§12 · §17.1, §11, §18
