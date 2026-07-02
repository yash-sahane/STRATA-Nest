# ADR-0010 — Strangler-fig, dependency-ordered migration

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer

## Context
A big-bang rewrite of a system with no tests (D16), client-side business rules (A§10), and a frozen frontend contract (ADR-0003) is high-risk. The frontend talks to per-collection REST endpoints (A§14), which can be routed independently.

## Decision
Use the **Strangler Fig** pattern: stand up NestJS **alongside** the running Django app on the **same Postgres** (Prisma `introspect`, no initial data move), and route collections to NestJS **one module at a time** behind nginx + feature flags. Conversion follows a **strict dependency order** (Migration Order Matrix, M§9): Foundations → Auth/Users → Workspaces+RBAC → Projects → Requirements → Epics/Sprints → Tasks → Realtime → HR → Notifications/Activity → Files/Email → Integrations → Generation → decommission Django. Each phase must pass parity tests before the next.

## Consequences
- (+) Reversible, incremental, zero-downtime; risk isolated per module.
- (+) Shared DB avoids a data migration until the very end.
- (−) Temporary dual-run infra and routing complexity — accepted for safety.
- Follow-up: Phase 0 builds the contract + characterization harness that gates every phase (§19).

## Alternatives considered
- **Big-bang rewrite + cutover:** rejected — unsafe without tests and with client-side rules.
- **Random module order:** rejected — dependency order is mandatory (review: "migration order matters enormously").

## Traceability
A§10, A§14, D16 · §20, M§9
