# Phase 3 — Projects

**Status: 🚧 Implemented + unit-verified; live contract/e2e pending a DB+Django environment.**
Done: `ProjectsModule` (scoped CRUD reusing `WorkspaceAccessService` + RBAC `project:*`), creator stamping (owner/createdBy/createdByName), date-only `startDate`/`endDate`, `member_ids`/`settings` JSON, Prisma `Project` mapped to `projects_project`, mapper field-order unit test; typecheck + DI graph green.
Pending: live contract suite (filter/sort/pagination parity) vs Django+Nest.

## Goal
Port the `Project` resource — the root of the PM hierarchy — with full CRUD parity and workspace scoping.

## Scope
- `ProjectsModule`: `projects` CRUD (A§6.2).
- Creator stamping (`owner`, `created_by`, `created_by_name`) in the service.
- `member_ids` JSON preserved on the wire; decision recorded on whether to also add a `ProjectMember` join (deferred if not needed).

## Out of Scope
- Requirements/epics/sprints/tasks (later phases) — only the FK targets they reference.
- Analytics/dashboards over projects (CQRS read models, if any, are Phase 9+).

## Deliverables
- `Project` Prisma model (introspected; real FKs to workspace/owner/createdBy).
- Controller/service/DTOs; `WorkspaceGuard` + `@RequirePermission('project:*')`.
- Char + contract tests for all `projects` endpoints incl. filter/sort/pagination parity.

## Acceptance Criteria
- [ ] `GET/POST/PATCH/DELETE /projects` byte-identical to Django (contract suite).
- [ ] Generic filter operators + `ordering` + `{items,total,page,pageSize}` reproduced exactly.
- [ ] `perform_create` semantics (owner/createdBy/createdByName) match.
- [ ] `Index(workspace,status)` present; list performance ≥ Django.
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flag for `projects`. Read-only against shared DB (no destructive schema change beyond additive relations, which are nullable). Flip back instantly.

## Risks
- **`member_ids` denormalization drift** (D12) → keep JSON as source on the wire; do not silently change semantics.
