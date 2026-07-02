# Phase 8 — Attendance, Leave, Time Tracking

**Status: 🚧 Implemented + unit-verified; live contract/e2e pending a DB+Django environment.**
Done: `AttendanceModule` (attendance, holidays), `LeaveModule` (leave_requests, leave_balances), `TimeTrackingModule` (time_entries scoped, active_timers unscoped) — CRUD parity via `ScopedCrudService` + creator stamping. **[NEW] D9 server-side logic ported verbatim from the frontend utils and unit-tested:** attendance check-in/out (`lateMinutes`/`workHours`/`status`, 08:30 + 15m grace, 4h half-day, alternate-Saturday weekends); `LeaveApprovalService` (approve → **deduct the mapped `LeaveBalance` field**, manager-only, **self-approval blocked**); timer start/pause/resume/stop (duration minus paused) → time entry; time-entry approve/reject. Typecheck + DI graph green; 56 api unit tests.
**Deferred/deviations (documented):** `active_timers` stays **unscoped without `workspaceId`** (D5 gap reproduced; column addition is a later migration); compute uses the server TZ for the 08:30 comparison (align `WORK_TZ` before flipping source of truth); `LeaveBalance` writes are manager-only (`leave:approve`) — a slight tightening vs Django's unguarded balance edits.
Pending: dual-source reconciliation (server vs frontend values) + live contract/e2e.

## Goal
Port the HR domains and **move their business rules server-side** — hours/late computation, leave approval + balance deduction, timer lifecycle — which live in the frontend today (A§6.7–6.9, D9).

## Scope
- `AttendanceModule` (`attendance`, `holidays`), `LeaveModule` (`leave_requests`, `leave_balances`), `TimeTrackingModule` (`time_entries`, `active_timers`).
- **[NEW]** server-side: check-in/out + `workHours`/`lateMinutes`/`status`; `LeaveApprovalService` (approve → deduct `LeaveBalance`, §3.1); timer start/stop/pause + `duration`; time-entry approve/reject.
- Scope `ActiveTimer` by adding `workspaceId` (closes D5).

## Out of Scope
- Reminder/attendance scheduled jobs (Phase 10+ worker) — only the synchronous paths here.
- Notifications/email on approvals (Phase 9/10; events emitted now).

## Deliverables
- HR Prisma models (+ `ActiveTimer.workspaceId`); controllers/services/DTOs.
- Ported computation formulas (reconciled against `frontend/src/lib/leave-utils.ts` and attendance logic).
- Char + contract tests incl. **dual-source reconciliation** (server result == current frontend result) before switching source of truth.

## Acceptance Criteria
- [ ] CRUD endpoints byte-identical; unique constraints preserved (`(workspace,user,date)`, `(workspace,user,year)`).
- [ ] Server-computed `workHours`/`daysCount`/`duration` match the frontend's values on a reconciliation corpus.
- [ ] Leave approval deducts balance transactionally; self-approval blocked by RBAC (D3/D9).
- [ ] `ActiveTimer` no longer leaks across workspaces (D5).
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flags per collection. Computation runs server-side but the frontend still sends its computed values during dark-launch; reconcile, then flip the source of truth. Revert = route back to Django (which trusts client values). `ActiveTimer.workspaceId` is additive/backfilled.

## Risks
- **Formula drift** between server and frontend → gate the flip on a green reconciliation report.
- **Balance double-deduction** on retries → idempotent approval keyed by request id.
