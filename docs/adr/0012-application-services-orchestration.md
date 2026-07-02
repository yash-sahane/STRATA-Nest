# ADR-0012 — Application Services for cross-module orchestration

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect (per architecture review)

## Context
Default layering is `Controller → Service → Prisma` (ADR-0004) with domain modules that never import each other (§3). But real workflows span modules — invitation acceptance (workspaces + invitations + membership), sprint completion (sprints + tasks), leave approval (leave request + balance + authz) — and own an invariant no single module should. Today these are client-driven or one giant view (A§4.9, A§10).

## Decision
Place cross-module workflows in thin **Application Services** under `apps/api/src/application/`. They compose domain services within one transaction and emit a single post-commit event (ADR-0007). They contain **orchestration, not domain rules** (rules stay in the owning domain service). **Direction rule:** application services depend on domain services; domain modules never import application services. Heuristic: ≥2 domain services in one transaction ⇒ Application Service; one aggregate ⇒ keep it in that module.

## Consequences
- (+) Cross-cutting workflows get a clear, testable home; domain modules stay decoupled (resolves A§11.1 explicitly).
- (+) Transactions + side-effect ordering are enforced in one place.
- (−) An extra layer for the minority of multi-module use cases — justified by the coupling it prevents.

## Alternatives considered
- **Fat domain service reaching into other modules:** rejected — recreates module→module coupling.
- **Orchestrate from controllers:** rejected — no transaction/event boundary, untestable.

## Traceability
A§4.9, A§10, A§11.1 · §3.1, ADR-0004, ADR-0007
