# Phase 2 — Workspaces + RBAC + Invitations / Join Requests

## Goal
Port workspaces and membership, and introduce **server-enforced RBAC** (the authorization layer that every later resource relies on) plus the invitation/join **workflows** that are client-driven today (A§6.1, D3).

## Scope
- `WorkspacesModule`: `workspaces`, `workspace_members`, `workspace_roles`, `invite_codes`, `email_invitations`, `join_requests`, `pending_workspace_access` (CRUD parity).
- `WorkspaceGuard` (membership scoping parity with the Django base viewset, incl. superuser/`is_admin_flag` bypass) + `PermissionsGuard` (`@RequirePermission`) backed by normalized `Permission`/`RolePermission`/`UserPermission` (ADR-0005).
- Application services **[NEW]**: `InvitationAcceptanceService`, `JoinRequestApprovalService` (§3.1) — transactional, event-emitting.

## Out of Scope
- Realtime broadcast of membership events (Phase 7 wires the gateway; events are emitted now, consumed later).
- Notification/email side effects beyond stubs (Phases 9/10).

## Deliverables
- Workspace models (introspected + `WorkspaceRole` normalized permissions).
- RBAC guards + default role→permission seed for the 7 built-in roles (A§5.1).
- Invitation accept + join approve/reject endpoints/flows with parity to current client behavior.
- Char + contract tests for all workspace endpoints and the new workflows.
- `@lt/testing` workspace/membership helpers.

## Acceptance Criteria
- [ ] All workspace collection endpoints byte-identical to Django (contract suite).
- [ ] Membership scoping identical: a member sees exactly the same rows as before.
- [ ] RBAC enforced: non-privileged members can no longer perform manager-only writes (documented behavior change, guarded by tests) — **and** every previously-allowed action for the right role still works.
- [ ] Invitation acceptance + join approval run in one transaction and emit `InvitationAccepted`/`JoinRequestApproved` after commit.
- [ ] Migration protocol followed per endpoint.

## Rollback Strategy
nginx per-collection flags. RBAC is enforced in Nest only; reverting a collection to Django restores the old membership-only behavior. Permission tables are additive (seed-only); no destructive change. Keep RBAC behind a flag so it can be loosened to "membership-only" to match Django during dark-launch.

## Risks
- **RBAC over-restricts** vs today's anything-goes → seed permissions generously first, tighten with explicit tests; ship behind a flag.
- **Two access-request models** (`JoinRequest` vs `PendingWorkspaceAccess`, D14) → reconcile in the plan; keep both endpoints until frontend usage confirmed.
