# Phase 5 — Epics + Sprints + Retrospectives

## Goal
Port planning entities (`Epic`, `Sprint`, `Retrospective`) with parity and add the **sprint-completion** orchestration.

## Scope
- `EpicsModule`: `epics`; `SprintsModule`: `sprints`, `retrospectives` (A§6.4, §6.5).
- Promote `Epic.requirementId` soft FK → nullable relation.
- `SprintCompletionService` **[NEW]** (§3.1): close sprint → roll/flag incomplete tasks → seed retrospective → emit `SprintCompleted`.

## Out of Scope
- Task rescheduling logic beyond flag/roll (task internals are Phase 6).
- Burndown/analytics read models (Phase 9+ if needed).

## Deliverables
- Epic/Sprint/Retrospective Prisma models; controllers/services/DTOs.
- `SprintCompletionService` + `SprintCompleted` event contract.
- Char + contract tests for all endpoints and the completion flow.

## Acceptance Criteria
- [ ] Epic/Sprint/Retro endpoints byte-identical (incl. `Index(project,status)`).
- [ ] Sprint completion is transactional and emits `SprintCompleted` after commit.
- [ ] `retrospectiveNotes` and Retrospective JSON arrays reproduced exactly.
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flags per collection. `SprintCompletionService` is new behavior behind the sprints route flag; reverting the route restores the current status-only PATCH behavior. Additive schema only.

## Risks
- **Sprint completion previously client-driven** → the new server flow must reproduce the exact fields the frontend set; captured by characterization tests.
