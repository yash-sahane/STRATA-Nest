# Phase 6 — Tasks (+ Comments, Kanban, Labels, Dependencies)

**Status: 🚧 Implemented + unit-verified; live contract/e2e pending a DB+Django environment.**
Done: `TasksModule` — `tasks` + `labels` (workspace-scoped, RBAC `task:read/write`, creator stamping), `task_comments` + `kanban_columns` (**unscoped**, reproducing Django's no-workspace behavior). Prisma models mapped to `tasks_*` (indexes preserved). Task 30-field mapper order unit-tested. Kanban move = PATCH `status`+`position` (parity). **Phase 5→6 loop:** `SprintCompletedTaskRoller` (`@OnEvent('sprint.completed')`) detaches incomplete tasks from the sprint — unit-tested. Typecheck + DI graph green.
**Deferred (documented, ADR-0008):** `Task.labels`→`TaskLabel` join and `blocked_by`/`blocks`→`TaskDependency` edge table (+ cycle checks) — normalization needs a live-DB backfill and preserves the wire arrays; done in a later data-quality pass. Soft FKs stay scalar id strings.
Pending: live contract suite; e2e for scoping/RBAC/kanban/roll.

## Goal
Port the largest domain — tasks and their satellites — with parity, promoting soft FKs and normalizing JSON arrays where querying matters (ADR-0008).

## Scope
- `TasksModule`: `tasks`, `task_comments`, `kanban_columns`, `labels` (A§6.6).
- Promote `Task` soft FKs (`sprintId`,`epicId`,`functionalRequirementId`,`parentTaskId`) → nullable relations.
- `Task.labels` JSON → `TaskLabel` join over `Label` (wire `labels[]` preserved); `blocked_by`/`blocks` → `TaskDependency` edge table with cycle checks.
- Server-side **kanban move/reorder** and **blocker** operations (previously client-only, D9) with identical resulting fields.

## Out of Scope
- Realtime task events delivery (emitted now, delivered Phase 7).
- Notifications on assignment (Phase 9).

## Deliverables
- Task + Comment + KanbanColumn + Label + TaskLabel + TaskDependency Prisma models + backfill.
- Controllers/services/DTOs; move/reorder/dependency logic; events (`TaskCreated/Assigned/Moved/Completed/Deleted/CommentAdded`).
- Char + contract tests for every endpoint + kanban/label/dependency behaviors.

## Acceptance Criteria
- [ ] All task-domain endpoints byte-identical (incl. `labels`, `assigneeIds`, `watcherIds`, `position`, `customFields`).
- [ ] `TaskLabel`/`TaskDependency` normalization is invisible on the wire.
- [ ] Kanban move produces identical `status`+`position` results as the current PATCH.
- [ ] Dependency cycles rejected; bidirectional consistency guaranteed server-side.
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flags per collection. Normalization ships with dual-write/compat: the `labels` JSON column is retained during dark-launch so a revert to Django reads valid data. `TaskDependency`/`TaskLabel` are additive tables; migrate-down drops them without touching the JSON source of truth.

## Risks
- **JSON→table normalization data loss** → retain original JSON columns until flip is stable; backfill validated by row-count + spot checks.
- **Largest surface** → split contract tests per sub-resource; canary tasks before comments/labels.
