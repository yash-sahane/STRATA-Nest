# Phase 12 — Generation (bulk-save) + AI + Django Decommission

## Goal
Port the AI-generation persistence (`bulk-save`) with exact hierarchy-id/classification behavior, separate `AiModule` (infra) from `GenerationModule` (business), and **retire Django**.

## Scope
- `GenerationModule`: `POST /bulk-save` — transactional CR→Epic→FR→Task tree with the exact hierarchy-id rules and TECHNICAL/FUNCTIONAL classification (A§4.9).
- `AiModule`: model/prompt infrastructure (if generation moves server-side; else the frontend keeps calling the model and only persistence is server-side).
- Final cutover: all collections on NestJS; decommission Django app + Channels + (unused) Celery.

## Out of Scope
- New generation features beyond current behavior.

## Deliverables
- `GenerationService.bulkSave()` in a Prisma `$transaction` + `HierarchyIdService`; `Idempotency-Key` support.
- Char + contract tests reproducing the exact tree/ids/classification for representative payloads.
- Decommission checklist; Django kept in cold standby for a defined window, then removed.

## Acceptance Criteria
- [ ] `bulk-save` produces byte-identical results (ids, hierarchy codes, links, classification) vs Django for the test corpus.
- [ ] Idempotent under retry (same key → same result, no duplicate tree).
- [ ] 100% of endpoints served by NestJS; contract suite fully green against Nest.
- [ ] Django receives zero production traffic for the standby window; then removed.

## Rollback Strategy
`bulk-save` behind a flag routing to Django until parity proven. Decommission is staged: (1) 0% traffic to Django but kept running, (2) stop Django, (3) remove after the standby window. Any regression → re-point nginx to Django.

## Risks
- **Hierarchy-id / classification edge cases** (the most logic-heavy endpoint) → large characterization corpus; diff every field.
- **"Last mile" residual endpoints** → API_COMPATIBILITY must be 100% ✓ before decommission.
