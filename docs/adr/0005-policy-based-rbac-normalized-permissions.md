# ADR-0005 — Policy-based RBAC with normalized permissions

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Security

## Context
Today authorization is **membership-only** (A§5.5): any active `WorkspaceMember` can CRUD any in-scope resource, including approving their own leave/time (A§10, D3, D9). A `role` enum, `WorkspaceMember.role` (free string), and `WorkspaceRole.permissions` (JSON) exist as **data but are never enforced**. Ad-hoc `if role==`/`is_admin_flag` checks are scattered (invite, bulk-save, self-update).

## Decision
Introduce **three composable, server-enforced layers**: authentication guard → workspace-scope guard (preserving current membership scoping + superuser/`is_admin_flag` bypass) → **policy/permission guard**. Permissions resolve through **normalized tables** `Permission` / `RolePermission` / `UserPermission` (replacing the JSON list), seeded with a default role→permission map for the 7 built-in roles and extensible via custom `WorkspaceRole`s. No hardcoded role checks in handlers.

## Consequences
- (+) Closes the self-approval / unrestricted-write hole (D3, D9); custom roles finally do something.
- (+) Central, testable policy registry replaces scattered `if`s.
- (−) New surface to seed/maintain; migration must read legacy JSON then cut over.
- Follow-up: preserve existing bypasses *deliberately* with explicit tests before tightening (§19).

## Alternatives considered
- **Keep JSON permissions:** rejected — hard to query/index/validate (review #13).
- **Hardcoded role checks:** rejected — the current ad-hoc approach that caused the gaps.

## Traceability
A§5.1, A§5.5, A§6.1, D3, D9 · §7, M§2 (authz)
