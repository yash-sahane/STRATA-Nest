# ADR-0005 — Policy-based RBAC with normalized permissions

- Status: Accepted, amended — the three layers are built; the normalized tables were dropped (see "As built")
- Date: 2026-06-30
- Deciders: Principal Architect, Security

## Context
Membership-only authorization is not enough on its own: if any active `WorkspaceMember` could CRUD any in-scope resource, a user could approve their own leave or time entries. Roles and permissions must be first-class and actually enforced — not stored as an unenforced JSON list read by ad-hoc `if role==`/`is_admin_flag` checks scattered across handlers (invite, bulk-save, self-update).

## Decision
Enforce **three composable, server-enforced layers**: authentication guard → workspace-scope guard (membership scoping + superuser/`is_admin_flag` bypass) → **policy/permission guard**. Permissions resolve through **normalized tables** `Permission` / `RolePermission` / `UserPermission` rather than a JSON blob, seeded with a default role→permission map for the 7 built-in roles and extensible via custom `WorkspaceRole`s. No hardcoded role checks in handlers.

## Consequences
- (+) Prevents self-approval and unrestricted writes; custom roles carry real, enforced permissions.
- (+) A central, testable policy registry instead of scattered `if` checks.
- (−) New surface to seed and maintain (the permission tables and the default role map).
- Follow-up: cover the intended bypasses (superuser/admin) with explicit tests before tightening rules.

## As built (2026-10-18)
The authentication, workspace-scope and permission layers are enforced as decided. The
permissions resolve from the built-in role → permission map in code
(`apps/api/src/modules/authz/permissions.ts`) plus each custom `WorkspaceRole`'s
`permissions` list, validated against the known keys, with implied keys added
(`task:write` grants `task:update` and `task:create`).

Decided: the `Permission` / `RolePermission` / `UserPermission` tables are **dropped**
(migration `20261018040000_one_assignee_list`). Nothing ever read them, and a second
copy of the role map would have needed keeping in step with the first. The map in code
is the one source; the browser does not keep a copy either — it asks
`GET /auth/me/access` for every membership's role and effective keys and translates the
keys into screen permissions. The roles screen's description of the built-in roles is
pinned to the API's map by `authz/role-catalogue-parity.spec.ts`.

## Alternatives considered
- **JSON permission lists:** rejected — hard to query, index, and validate.
- **Hardcoded role checks in handlers:** rejected — ad-hoc and easy to make inconsistent.
