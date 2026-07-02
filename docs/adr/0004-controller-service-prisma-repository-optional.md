# ADR-0004 — Controller → Service → Prisma; repository layer is opt-in

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer (per architecture review)

## Context
The Django side is thin CRUD ViewSets (A§4.6, A§6). A naive port adds a `Repository` per module, but NestJS + Prisma already abstract the ORM. A mandatory repository over CRUD becomes `TaskRepository.create()` → `prisma.task.create()` — pure boilerplate (review feedback, est. +25–35% code for no value).

## Decision
Default layering is **Controller → Service → Prisma.** The service owns business logic *and* data access (with a shared workspace-scope helper). A **Repository is introduced only on demonstrated need** — complex joins, aggregates, or reusable query specifications — never as a pass-through wrapper.

## Consequences
- (+) ~25–35% less boilerplate across ~30 CRUD collections.
- (+) Easier to read; fewer indirections.
- (−) Risk of fat services if complexity creeps — mitigated by the opt-in repository rule and Application Services (ADR-0012) for cross-module orchestration.
- Follow-up: lint/review guideline — extract a repository the moment a service method exceeds simple CRUD/scoping.

## Alternatives considered
- **Mandatory Repository Pattern everywhere:** rejected — doubles code without value on CRUD.
- **Active Record (Prisma in controllers):** rejected — no place for transactions/events/policies.

## Traceability
A§4.6, A§6 · §2, §3, §5, M§5
