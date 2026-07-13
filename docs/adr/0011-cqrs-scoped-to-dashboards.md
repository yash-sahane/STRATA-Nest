# ADR-0011 — CQRS scoped to read-heavy dashboards only

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect (per architecture review)

## Context
The product is fundamentally CRUD-shaped. Applying CQRS globally (separate command/query models everywhere) would multiply code for no benefit. But some surfaces — workspace analytics, sprint burndown, time/attendance summaries — are genuinely read-heavy and aggregate across many tables, and they need a read path that doesn't tax the transactional write model.

## Decision
**Do not** adopt CQRS system-wide. Commands and queries share the same services/Prisma models across the transactional domain. **Introduce read-side projections only for read-heavy dashboards/reports**, where the query aggregates broadly and the read pattern diverges from the write model. Such read models are Postgres materialized views or event-fed projection tables, invalidated via domain events.

## Consequences
- (+) Dashboards stay fast without taxing the write path; no global complexity tax.
- (−) A small number of projections to maintain/invalidate — contained and event-driven.
- Follow-up: each projection documents its source events and refresh trigger.

## Alternatives considered
- **Global CQRS:** rejected — over-engineering for a CRUD-shaped product.
- **Ad-hoc heavy queries on the write model:** rejected for dashboards — risks slow, lock-prone aggregate scans.
