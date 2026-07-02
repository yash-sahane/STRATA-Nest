# ADR-0001 — Modular monolith with API/Worker split (not microservices)

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer

## Context
The brief invites a "modern, scalable" backend and lists microservice-style concerns. The audit (A§1, A§11.1) shows the opposite reality: one cohesive, membership-scoped domain with **no existing service boundaries** — Django apps already cross-import a shared workspace/membership concept lazily. There is one team, one database, one product surface.

## Decision
Build a **modular monolith** in a TypeScript monorepo with exactly **one hard process boundary: API (HTTP+WS) vs Worker (BullMQ consumers)** — the only split the brief mandates and the workload justifies. Domain modules are isolated within the API process and communicate across boundaries via domain events, never direct imports.

## Consequences
- (+) Fastest path to add the missing server-side behavior while keeping the camelCase contract intact.
- (+) Clean seams (events, worker) enable later extraction (see ADR with §22 candidates).
- (−) Shared deployable; a module fault can affect the process — mitigated by module isolation, guards, and the worker split for heavy/async work.
- Follow-up: enforce module boundaries with lint rules; keep event contracts in `packages/shared/events`.

## Alternatives considered
- **Microservices now:** rejected — no domain boundaries exist yet (A§11.1); premature distribution adds ops cost, latency, and data-consistency complexity for no benefit.
- **Single process (no worker):** rejected — async/scheduled work is absent today (A§8) and must not run in the request path.

## Traceability
A§1, A§8, A§11.1 · §1, §22
