# ADR-0004 — Controller → Service → Prisma; repository layer is opt-in

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer (per architecture review)

## Context
Most collections are thin CRUD. A mandatory `Repository` per module adds no value over NestJS + Prisma (which already abstract the ORM): `TaskRepository.create()` → `prisma.task.create()` is pure boilerplate (est. +25–35% code).

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

