# Phase 9 — Notifications + Activity Engines

## Goal
Turn notifications and activity from client-written records (A§6.10–6.11, D9) into **event-driven, server-guaranteed** engines, with append-only audit.

## Scope
- `NotificationsModule` (`notifications` CRUD + `mark_all_read`), `NotificationSubscriber` (reacts to domain events → creates notifications + enqueues delivery), `Notification`→`NotificationDelivery` split.
- `ActivityModule` (`activity_logs`, `saved_searches`), `AuditSubscriber` writing **append-only** `ActivityLog`.

## Out of Scope
- Email/push transport internals (Phase 10 email queue; push is future).
- Search engine (still generic filter + `SavedSearch`).

## Deliverables
- Notification/Activity Prisma models (+ `NotificationDelivery`); INSERT-only grant on `ActivityLog`.
- Event subscribers wired to Phases 1–8 events.
- Char + contract tests; a test proving audit rows are immutable.

## Acceptance Criteria
- [ ] `notifications` CRUD + `mark_all_read` byte-identical.
- [ ] Server now emits notifications/audit from domain events (no longer requires the client to POST them) while still accepting client POSTs during transition.
- [ ] `ActivityLog` rejects UPDATE/DELETE (append-only) — explicit test.
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flags. Subscribers are additive; disabling them reverts to client-written behavior. `NotificationDelivery` is a new table (additive). Append-only grant is reversible.

## Risks
- **Double notifications** (client POST + server subscriber) during transition → dedupe key + a switch to disable client-side creation once server path proven.
