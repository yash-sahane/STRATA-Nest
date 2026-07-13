# ADR-0008 — Promote soft foreign keys to nullable relations + backfill

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer, Data

## Context
Several cross-domain links are modeled as bare string IDs with **no referential integrity**: `Task.{sprintId,epicId,functionalRequirementId,parentTaskId}`, `FunctionalRequirement.{epicId,sprintId,clientRequirementId}`, `Epic.requirementId`, `TimeEntry.{taskId,projectId}`, `Notification.projectId`, `UploadedFile.{workspaceId,projectId}`, and more. Such values can be `""` or dangle. Collections encoded as JSON arrays (`labels`, `blocked_by`/`blocks`) or CSV strings (`tags`, `linked_project_ids`) compound the problem — they can't be indexed or joined.

## Decision
Promote soft FKs to **real Prisma relations**, but **nullable**, and enforce them only **after a data-quality backfill** (`""` → null, drop/repair orphans). Replace JSON/CSV collections with proper structures where querying matters: a `TaskLabel` join, a `TaskDependency` edge table, `String[]` for tags. Keep wire shapes unchanged (e.g., `labels: [...]` composed from the join, ADR-0003).

## Consequences
- (+) DB-level integrity, cascades, and orphan prevention; indexable label/dependency queries.
- (−) The backfill migration must tolerate dirty data — hence nullable columns and a repair pass, never a hard fail.
- Follow-up: a characterization step counts dangling/`""` values per column before enabling constraints.

## Alternatives considered
- **Keep soft FKs:** rejected — perpetuates orphans and blocks cascades (the core integrity problem).
- **Promote straight to NOT NULL:** rejected — would reject rows that legitimately have empty or dangling links before the backfill runs.
