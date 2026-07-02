# Migration Phases — Definition of Done

One **Definition of Done (DoD)** document per phase of the Migration Order Matrix ([../../MIGRATION_MATRIX.md](../../MIGRATION_MATRIX.md) §9). Every phase is auditable: it is "done" only when its **Acceptance Criteria** are all met and its DoD is checked off. Phases ship in strict dependency order.

## The Migration Protocol (mandatory — every phase, every endpoint)

**Never migrate directly.** Each resource follows this pipeline before it is considered done:

```
Django (source of truth)
   ↓  1. Characterization test   — capture the real Django response/behavior
NestJS implementation
   ↓  2. Contract test           — assert Nest output is byte-identical to Django (ADR-0003)
Feature flag / nginx route
   ↓  3. Dark-launch + canary    — route a slice of traffic; compare
Production
   ↓  4. Flip + monitor          — 100% to Nest; Django kept warm for rollback
```

- **Characterization tests** live in `@lt/contract-tests` (run against `DJANGO_API_URL`).
- **Contract tests** are the same suite re-pointed at NestJS (`CONTRACT_BASE_URL`).
- **Feature flag / route** is per-collection at nginx (ADR-0010) — reversible in seconds.
- Django is **not decommissioned** until Phase 12.

## DoD document template

Each `PHASE_N.md` contains exactly these sections:

| Section | Meaning |
|---|---|
| **Goal** | The one-sentence outcome |
| **Scope** | What this phase delivers (modules, endpoints, models) |
| **Out of Scope** | What it explicitly does not touch (prevents scope creep) |
| **Deliverables** | Concrete artifacts (code, docs, tests, migrations) |
| **Acceptance Criteria** | Checklist that must be 100% green to close the phase |
| **Rollback Strategy** | How to revert this phase with zero data loss |
| **Risks** | What could go wrong + mitigation |

## Index

| Phase | Title | Status |
|---|---|---|
| [0](PHASE_0.md) | Foundations (scaffold, infra, harness) | ✅ Done |
| [1](PHASE_1.md) | Auth + Users | 🚧 Implemented + unit-verified ([PHASE_1_AUTH_PLAN](../PHASE_1_AUTH_PLAN.md)) |
| **1A** | **Live Verification — GATE before Phase 2** | 🚧 crypto ✅ (pw + JWT bidirectional, real Django); endpoints/cross/browser/bench pending ([PHASE_1A_VERIFICATION](../PHASE_1A_VERIFICATION.md), [AUTH_BENCHMARK](../AUTH_BENCHMARK.md), [AUTH_SECURITY_CHECKLIST](../AUTH_SECURITY_CHECKLIST.md)) |
| [2](PHASE_2.md) | Workspaces + RBAC + Invitations/Join | ⏳ Pending |
| [3](PHASE_3.md) | Projects | ⏳ Pending |
| [4](PHASE_4.md) | Requirements (CR + FR) | ⏳ Pending |
| [5](PHASE_5.md) | Epics + Sprints + Retrospectives | ⏳ Pending |
| [6](PHASE_6.md) | Tasks (+ Comments, Kanban, Labels, Dependencies) | ⏳ Pending |
| [7](PHASE_7.md) | Realtime gateway + event bus | ⏳ Pending |
| [8](PHASE_8.md) | Attendance, Leave, Time Tracking | ⏳ Pending |
| [9](PHASE_9.md) | Notifications + Activity engines | ⏳ Pending |
| [10](PHASE_10.md) | Files + Email queue | ⏳ Pending |
| [11](PHASE_11.md) | Integrations (webhooks, Git queue, token encryption) | ⏳ Pending |
| [12](PHASE_12.md) | Generation + AI + Django decommission | ⏳ Pending |

Parity is tracked per endpoint in [../API_COMPATIBILITY.md](../API_COMPATIBILITY.md).
