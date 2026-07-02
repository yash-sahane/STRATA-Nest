# Phase 4 — Requirements (Client + Functional)

## Goal
Port `ClientRequirement` and `FunctionalRequirement` with parity, and begin **soft-FK promotion** (ADR-0008) for FR links.

## Scope
- `RequirementsModule`: `client_requirements`, `functional_requirements` CRUD (A§6.3).
- Promote FR soft FKs (`epicId`, `sprintId`, `clientRequirementId`) → nullable relations; CSV `tags`/`linkedProjectIds` → `String[]` (wire shape preserved).

## Out of Scope
- Epic/sprint enforcement of the new relations (those models land Phase 5); relations stay nullable meanwhile.
- The bulk-generation endpoint (Phase 12).

## Deliverables
- CR/FR Prisma models with nullable promoted relations + backfill script (`""` → null).
- Controllers/services/DTOs; hierarchy_id fields preserved verbatim.
- Char + contract tests; data-quality report of dangling/`""` FR links pre-backfill.

## Acceptance Criteria
- [ ] CR/FR endpoints byte-identical (fields incl. `hierarchyId`, `assignedTo`, `tags`, `complexity`, `status`).
- [ ] Promoted relations do not change any response shape (still emit the id strings/arrays).
- [ ] Backfill leaves zero broken constraints; dangling values reported, not dropped silently.
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flags for the two collections. Relation promotion is nullable + additive; a `prisma migrate` down restores prior columns. No data loss (backfill only nulls empty strings, logged).

## Risks
- **Orphaned soft FKs surface** on promotion (D6) → nullable + backfill + report; never hard-fail import.
- **CSV→array conversion** edge cases → characterization test captures exact current parsing.
