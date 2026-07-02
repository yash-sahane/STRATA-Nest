# Architecture Decision Records (ADRs)

This directory records the **major architectural decisions** for the L‑T‑Connect NestJS re-platform, in [MADR](https://adr.github.io/madr/) style.

## Conventions
- One decision per file, named `NNNN-short-slug.md`.
- An ADR is **immutable once `Accepted`.** A changed decision is captured by a **new** ADR that marks the old one `Superseded by ADR-XXXX` — we never edit history.
- Every ADR is traceable to the audit ([../../CURRENT_SYSTEM_AUDIT.md](../../CURRENT_SYSTEM_AUDIT.md), `A§n`), the migration matrix ([../../MIGRATION_MATRIX.md](../../MIGRATION_MATRIX.md), `M§n`), and the architecture ([../../TARGET_ARCHITECTURE_NESTJS.md](../../TARGET_ARCHITECTURE_NESTJS.md), `§n`).

## Template
```
# ADR-NNNN — <title>
- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD
- Deciders: <roles>

## Context        # forces, constraints, what the audit found
## Decision       # the choice, stated plainly
## Consequences   # positive / negative / follow-ups
## Alternatives considered
## Traceability    # A§ / M§ / §
```

## Index
| ADR | Decision | Status |
|---|---|---|
| [0001](0001-modular-monolith-api-worker-split.md) | Modular monolith with API/Worker split (not microservices) | Accepted |
| [0002](0002-preserve-string-primary-keys.md) | Preserve 20-char string primary keys | Accepted |
| [0003](0003-freeze-v1-rest-ws-contract.md) | Freeze the v1 REST/WS contract | Accepted |
| [0004](0004-controller-service-prisma-repository-optional.md) | Controller→Service→Prisma; repository opt-in | Accepted |
| [0005](0005-policy-based-rbac-normalized-permissions.md) | Policy-based RBAC with normalized permissions | Accepted |
| [0006](0006-authorized-realtime-via-domain-events.md) | Authorized realtime rooms via domain events | Accepted |
| [0007](0007-bullmq-async-commit-then-emit.md) | BullMQ async + commit-then-emit (no side effects in tx) | Accepted |
| [0008](0008-promote-soft-fks-to-relations.md) | Promote soft FKs to nullable relations + backfill | Accepted |
| [0009](0009-cookie-jwt-revocable-refresh.md) | Cookie JWT with server-tracked revocable refresh tokens | Accepted |
| [0010](0010-strangler-fig-migration.md) | Strangler-fig, dependency-ordered migration | Accepted |
| [0011](0011-cqrs-scoped-to-dashboards.md) | CQRS scoped to read-heavy dashboards only | Accepted |
| [0012](0012-application-services-orchestration.md) | Application Services for cross-module orchestration | Accepted |
