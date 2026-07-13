# ADR-0005 — Policy-based RBAC with normalized permissions

- Status: Accepted
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

## Alternatives considered
- **JSON permission lists:** rejected — hard to query, index, and validate.
- **Hardcoded role checks in handlers:** rejected — ad-hoc and easy to make inconsistent.
