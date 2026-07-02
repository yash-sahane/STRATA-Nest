# ADR-0008 — Promote soft foreign keys to nullable relations + backfill

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer, Data

## Context
Cross-domain links are stored as bare `CharField` IDs with **no referential integrity** (A§9.2): `Task.{sprintId,epicId,functionalRequirementId,parentTaskId}`, `FunctionalRequirement.{epicId,sprintId,clientRequirementId}`, `Epic.requirementId`, `TimeEntry.{taskId,projectId}`, `Notification.projectId`, `UploadedFile.{workspaceId,projectId}`, etc. Values may be `""` or dangle. JSON arrays (`labels`, `blocked_by`/`blocks`) and CSV `TextField`s (`tags`, `linked_project_ids`) compound the problem (D6, D13).

## Decision
Promote soft FKs to **real Prisma relations**, but **nullable**, and enforce only **after a data-quality backfill** (`""` → null, drop/repair orphans). Replace JSON/CSV collections with proper structures where querying matters: `TaskLabel` join, `TaskDependency` edge table, `String[]` for tags. Keep wire shapes unchanged (e.g., `labels: [...]` composed from the join, ADR-0003).

## Consequences
- (+) DB-level integrity, cascades, and orphan prevention; indexable label/dependency queries.
- (−) Migration must tolerate legacy dirty data — hence nullable + backfill, never a hard fail on import.
- Follow-up: a characterization step counts dangling/`""` values per column before enabling constraints.

## Alternatives considered
- **Keep soft FKs:** rejected — perpetuates orphans and blocks cascades (the core integrity gap, A§9.2).
- **Promote to NOT NULL immediately:** rejected — would reject importable legacy rows.

## Traceability
A§9.2, A§9.3, D6, D13 · §4, §5, M§2
