# ADR-0001 — Modular monolith with API/Worker split (not microservices)

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer

## Context
STRATA is one cohesive, membership-scoped domain: every module shares a common workspace/membership concept, so there are **no natural service boundaries** to split along. There is one team, one database, one product surface. A "modern, scalable" backend here means clean internal seams, not a fleet of services.

## Decision
Build a **modular monolith** in a TypeScript monorepo with exactly **one hard process boundary: API (HTTP+WS) vs Worker (BullMQ consumers)** — the split the workload actually justifies. Domain modules are isolated within the API process and communicate across boundaries via domain events, never direct imports.

## Consequences
- (+) Fast to build and evolve server-side behavior while keeping the camelCase contract intact.
- (+) Clean seams (events, worker) let a module be extracted into its own service later if a real boundary emerges.
- (−) Shared deployable; a module fault can affect the process — mitigated by module isolation, guards, and the worker split for heavy/async work.
- Follow-up: enforce module boundaries with lint rules; keep event contracts in `packages/shared/events`.

## Alternatives considered
- **Microservices:** rejected — no domain boundaries exist to split along; premature distribution adds ops cost, latency, and data-consistency complexity for no benefit.
- **Single process (no worker):** rejected — async/scheduled work must not run in the request path.
