# API Compatibility — Django → NestJS Parity Checklist

> **Purpose:** the authoritative endpoint-by-endpoint parity ledger. An endpoint is **done** only when its NestJS response is **byte-identical** to Django's, proven by the contract suite (`@lt/contract-tests`, ADR-0003). This file is updated as each Migration phase (M§9) lands.
>
> **Every endpoint below is enumerated** from the audit ([CURRENT_SYSTEM_AUDIT.md](CURRENT_SYSTEM_AUDIT.md) §14). All are mounted under `/api/v1/` with trailing slashes, cookie JWT auth, camelCase fields, the pagination envelope `{items,total,page,pageSize}`, and the error envelope `{error:{message,code,type}}`.

**Parity status legend:** ⏳ pending · 🚧 in progress · ✅ verified (contract test green vs Django) · ➕ new (no Django equivalent)

---

## Standard shapes (referenced below)

- **List** `GET /<collection>/` → `{ items: <Resource>[], total, page, pageSize }` (filter/sort via camel query params + `ordering`; A§4.3–4.4).
- **Create** `POST /<collection>/` → `201 <Resource>`
- **Retrieve** `GET /<collection>/{id}/` → `<Resource>`
- **Replace** `PUT /<collection>/{id}/` → `<Resource>`
- **Update** `PATCH /<collection>/{id}/` → `<Resource>`
- **Delete** `DELETE /<collection>/{id}/` → `204`
- **Error** (any) → `{ error: { message, code, type } }`

---

## Phase 1 — Auth & Users

> **Status: 🚧 Implemented in NestJS + unit-verified** (pbkdf2 Django-vector, token claims, refresh revocation). Rows flip to ✅ once the contract suite runs green against a live Django **and** the Nest API (requires the shared database + running services). Parity column shows 🚧 accordingly.

| Method | Path | Django response | Nest target | Parity |
|---|---|---|---|---|
| POST | `auth/login/` | `200 {user, sessionId}` + `Set-Cookie lt_access, lt_refresh` | identical | 🚧 |
| POST | `auth/logout/` | `204` + clear both cookies (blacklist refresh) | identical (+ revoke jti) | 🚧 |
| POST | `auth/refresh/` | `200 {ok:true}` + rotated cookies | identical (**+ revoke old jti**, D1) | 🚧 |
| POST | `auth/register/` | `201 {user, sessionId}` + cookies | identical | 🚧 |
| GET | `auth/me/` | `200 {user, session, workspaceIds, hasTempPassword, isAdmin}` | identical (D17 reproduced) | 🚧 |
| POST | `auth/change-password/` | `200 {ok:true}` / `400 {message}` | identical | 🚧 |
| PATCH | `auth/profile/` | `200 <User>` | identical | 🚧 |
| POST | `auth/password-reset/` | `200 {ok:true}` (constant-time) | identical | 🚧 |
| POST | `auth/password-reset/confirm/` | `200 {ok:true}` / `400 {message}` | identical | 🚧 |
| POST | `users/invite/` | `200/201 {success, type, userId, message}` | identical | 🚧 |
| GET | `users/` | list of `<User>` (shared-workspace scope; admin=all) | identical | 🚧 |
| GET | `users/{id}/` | `<User>` | identical | 🚧 |
| PATCH | `users/{id}/` | `<User>` (self/admin only) | identical | 🚧 |

**`<User>`**: `id, createdAt, updatedAt, email, userEmail, name, phone, avatar, role, workspaceId, defaultWorkspaceId, workspaceIds, status, hasTempPassword, isAdmin`

---

## Phase 2 — Workspaces, RBAC, Invitations, Join

> **Status: 🚧 Implemented + unit-verified** (RBAC map + `WorkspaceAccessService` scope/permission enforcement, 11 unit tests). Rows flip to ✅ after the live contract suite runs vs Django + Nest. **Behavior change (documented, D3):** with `RBAC_ENFORCED=true`, manager-only writes are denied to lower roles; `RBAC_ENFORCED=false` keeps a membership-only floor matching Django during dark-launch.

| Collection | CRUD | Resource fields | Parity |
|---|---|---|---|
| `workspaces` | L/C/R/U/D | `id, createdAt, updatedAt, name, description, logo, color, ownerId, inviteCode, settings, memberIds` | 🚧 |
| `workspace_members` | L/C/R/U/D | `…, workspaceId, userId, email, name, userName, phone, avatar, role, status, joinedAt` | 🚧 |
| `workspace_roles` | L/C/R/U/D | `…, workspaceId, name, permissions` | 🚧 |
| `invite_codes` | L/C/R/U/D | `…, workspaceId, code, role, maxUses, usedCount, expiresAt, createdBy` | 🚧 |
| `email_invitations` | L/C/R/U/D | `…, workspaceId, email, role, token, status, expiresAt, invitedBy` | 🚧 |
| `join_requests` | L/C/R/U/D | `…, workspaceId, userId, message, status, handledBy` | 🚧 |
| `pending_workspace_access` | L/C/R/U/D | `…, workspaceId, userId, requestedRole` | 🚧 |

**New workflow endpoints (additive, [NEW] — encapsulate what the client did via CRUD):**

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `workspaces/accept-invitation` | accept email-invitation token or invite code → membership (transactional) | ➕ 🚧 |
| POST | `join_requests/{id}/approve` | approve → create membership + mark request (transactional) | ➕ 🚧 |
| POST | `join_requests/{id}/reject` | reject → mark request | ➕ 🚧 |

---

## Phase 3 — Projects

> **Status: 🚧 Implemented + unit-verified** (scoped CRUD reusing `WorkspaceAccessService`; creator stamping; date-only `startDate`/`endDate`; mapper field-order unit test). Live contract pending.

| Collection | CRUD | Resource fields | Parity |
|---|---|---|---|
| `projects` | L/C/R/U/D | `…, workspaceId, name, shortCode, description, clientName, logo, color, methodology, status, archived, startDate, endDate, ownerId, createdBy, createdByName, memberIds, settings` | 🚧 |

---

## Phase 4 — Requirements

> **Status: 🚧 Implemented + unit-verified** (scoped CRUD via `ScopedCrudService`; creator stamping; mapper field-order tests). **Parity decisions (deviations from M§2, per the frozen contract ADR-0003):** `tags`/`linkedProjectIds` stay **strings** on the wire (Django serializes the CSV TextField as a string) — array normalization deferred to a v2 change; soft FKs `epicId`/`sprintId`/`clientRequirementId` stay **scalar id strings** — relation promotion + `""`→null backfill (ADR-0008) deferred to a live-DB data-quality pass once Epic/Sprint land (Phase 5).

| Collection | CRUD | Resource fields | Parity |
|---|---|---|---|
| `client_requirements` | L/C/R/U/D | `…, workspaceId, projectId, title, description, clientName, priority, status, attachments, createdBy, createdByName` | 🚧 |
| `functional_requirements` | L/C/R/U/D | `…, workspaceId, projectId, hierarchyId, epicId, sprintId, clientRequirementId, title, description, complexity, priority, status, progress, reusable, assignedTo, assignedToNames, tags, linkedProjectIds, createdBy, createdByName` | 🚧 |

---

## Phase 5 — Epics, Sprints, Retrospectives

> **Status: 🚧 Implemented + unit-verified** (scoped CRUD reusing `ScopedCrudService`; creator stamping; date-only epic/sprint dates; mapper field-order tests — incl. retrospective having **no** `createdByName`). `Epic.requirementId` stays a scalar id string (relation promotion deferred, ADR-0008). Live contract pending.

| Collection | CRUD | Resource fields | Parity |
|---|---|---|---|
| `epics` | L/C/R/U/D | `…, workspaceId, projectId, requirementId, hierarchyId, name, description, color, startDate, endDate, status, progress, assignedTeam, createdBy, createdByName` | 🚧 |
| `sprints` | L/C/R/U/D | `…, workspaceId, projectId, name, goal, startDate, endDate, status, retrospectiveNotes, createdBy, createdByName` | 🚧 |
| `retrospectives` | L/C/R/U/D | `…, workspaceId, projectId, sprintId, wentWell, needsImprovement, actionItems, createdBy` | 🚧 |

**New workflow endpoint (additive, [NEW]):**

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `sprints/{id}/complete` | close sprint + seed retrospective (transactional) → emit `sprint.completed` | ➕ 🚧 |

> Rolling incomplete **tasks** on completion is wired in **Phase 6** (a Tasks subscriber to `sprint.completed`) — Task isn't modeled yet.

---

## Phase 6 — Tasks & satellites

> **Status: 🚧 Implemented + unit-verified** (Task 30-field mapper order test; creator stamping; kanban move = PATCH `status`+`position`). **Parity decisions:** `task_comments` and `kanban_columns` have **no workspace column in Django**, so they are **not workspace-scoped** — reproduced faithfully (pre-existing gap; the frontend filters by `taskId`/`projectId`). Soft FKs and JSON arrays (`labels`, `blockedBy`, `blocks`, `assigneeIds`, …) stay as-is on the wire; the `TaskLabel`/`TaskDependency` normalization (M§2) is deferred to a live-DB pass (ADR-0008). Live contract pending.

| Collection | CRUD | Resource fields | Parity |
|---|---|---|---|
| `tasks` | L/C/R/U/D | `…, hierarchyId, sprintId, epicId, functionalRequirementId, parentTaskId, title, description, status, priority, assigneeIds, assignedBy, assignedByName, assignedTo, assignedToNames, watcherIds, createdBy, createdByName, dueDate, estimatedHours, actualHours, labels, attachments, customFields, position, blockedBy, blocks` | 🚧 |
| `task_comments` | L/C/R/U/D | `…, taskId, userId, content, mentions, attachments` (unscoped — Django parity) | 🚧 |
| `kanban_columns` | L/C/R/U/D | `…, projectId, name, status, wipLimit, position, color` (unscoped — Django parity) | 🚧 |
| `labels` | L/C/R/U/D | `…, workspaceId, projectId, name, color, description` | 🚧 |

> **Phase 5→6 loop:** a `sprint.completed` subscriber detaches incomplete (status ≠ DONE) tasks from the completed sprint (`sprintId → ""`). Unit-tested.

---

## Phase 8 — HR (Attendance, Leave, Time Tracking)

> **Status: 🚧 Implemented + unit-verified.** CRUD parity for all 6 collections (creator stamping per Django `perform_create`); **[NEW] server-side computation/approval ported from the frontend utils (D9)** — see workflow endpoints below. **Parity decisions:** `active_timers` stays **unscoped without `workspaceId`** (D5 gap reproduced; adding the column is a later migration, *not* done here — corrects my earlier note); computation uses the server's timezone for the 08:30 comparison (reconcile `WORK_TZ` before flipping source of truth).

| Collection | CRUD | Resource fields | Parity |
|---|---|---|---|
| `attendance` | L/C/R/U/D | `…, workspaceId, userId, date, checkInTime, checkOutTime, workHours, status, lateMinutes, location, notes, isWeekend, isHoliday, createdBy, createdByName` | 🚧 |
| `holidays` | L/C/R/U/D | `…, workspaceId, name, date, isOptional, description` | 🚧 |
| `leave_requests` | L/C/R/U/D | `…, workspaceId, userId, createdBy, createdByName, type, startDate, endDate, reason, status, approvedBy, approvedAt, rejectionReason, daysCount` | 🚧 |
| `leave_balances` | L/C/R/U/D | `…, workspaceId, userId, year, paidLeave, unpaidLeave, halfDay, compOff` | 🚧 |
| `time_entries` | L/C/R/U/D | `…, workspaceId, userId, userName, userEmail, createdBy, createdByName, taskId, taskTitle, taskHierarchyId, projectId, projectName, description, startTime, endTime, duration, isBillable, billableRate, type, status, approvedBy, approvedAt, rejectionReason, tags` | 🚧 |
| `active_timers` | L/C/R/U/D | `…, userId, taskId, taskTitle, taskHierarchyId, projectId, description, startTime, isPaused, pausedAt, totalPausedTime, type, pomodoroSettings` (**unscoped**, no workspaceId — D5 deferred) | 🚧 |

**New workflow endpoints (additive, [NEW] — the D9 computation/approval that was client-side):**

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `attendance/check-in` · `check-out` | compute `lateMinutes`/`workHours`/`status` server-side | ➕ 🚧 |
| POST | `leave_requests/{id}/approve` · `reject` | approve → **deduct `LeaveBalance`** (mapped by type); manager-only; **self-approval blocked** | ➕ 🚧 |
| POST | `time_entries/{id}/approve` · `reject` | manager-only, self-approval blocked | ➕ 🚧 |
| POST | `active_timers/start` · `pause` · `resume` · `stop` | timer lifecycle; `stop` computes `duration` (minus paused) → creates `time_entries` | ➕ 🚧 |

> Compute/deduction logic is **ported verbatim** from `frontend/src/lib/{attendance-utils,leave-balance-mapper,leave-utils}.ts` (unit-tested), so server values match the client on the reconciliation corpus before it becomes the source of truth.

---

## Phase 9 — Notifications & Activity

> **Status: 🚧 Implemented + unit-verified.** CRUD parity for all 3 collections + `mark_all_read`. **[NEW] server-guaranteed engines (D9):** a `NotificationSubscriber` and an append-only `AuditSubscriber` consume the Phases 2–8 domain events and write per-user notifications + audit rows — the frontend no longer has to POST them (client POSTs still accepted during transition). `createdAt`/`updatedAt` serialize **last** (NativeModelSerializer pop-and-re-add), matched byte-for-byte.

| Collection / endpoint | CRUD | Resource fields | Parity |
|---|---|---|---|
| `notifications` | L/C/R/U/D | `…, workspaceId, userId, type, title, message, projectId, relatedEntityId, relatedEntityType, isRead` | 🚧 |
| POST `notifications/mark_all_read/` | — | `{updated: <n>}` (caller's unread, membership-scoped) | 🚧 |
| `activity_logs` | **L/C/R only** | `…, workspaceId, userId, action, entityType, entityId, changes, metadata` | 🚧 |
| `saved_searches` | L/C/R/U/D | `…, workspaceId, userId, name, query, filters` | 🚧 |

**Parity decisions / deviations:**
- **`activity_logs` is append-only [NEW, D9]** — Django exposed PATCH/PUT/DELETE; Nest omits those routes and the service throws `403 append-only` on update/remove, so the audit trail is immutable. This is a *tightening* vs Django; documented so a reconciliation run doesn't flag the missing verbs as a regression.
- **`NotificationDelivery` (`notifications_notificationdelivery`) is a NEW additive table** (the Notification→delivery split, ADR-0011). Phase 9 writes the `in_app` delivery inline; `email`/`push` channels are Phase 10. It is **not** part of the wire contract.
- Notification `create` takes `userId` from the payload (Django parity — a notification is addressed to someone); `activity_logs`/`saved_searches` stamp `userId` = caller (Django `perform_create`).
- Server-emitted notifications currently cover the events Phases 2–8 actually emit (workspace member/join, leave/time decisions); more join automatically as later phases emit events. **Dedupe** for the client-POST + server-subscriber transition window is a live-gate follow-up.

---

## Phase 10 — Files & Email

| Method | Path | Django response | Parity |
|---|---|---|---|
| POST | `files/` (multipart) | `201 <File>` | ⏳ |
| GET | `files/{id}/` | `<File>` | ⏳ |
| DELETE | `files/{id}/` | `204` (deletes blob) | ⏳ |
| GET | `files/{id}/preview/` · `view/` | inline stream (`Content-Disposition: inline`) | ⏳ |
| GET | `files/{id}/download/` | attachment stream | ⏳ |
| POST | `email/send-invitation/` | `{success, backend, ...}` | ⏳ |
| POST | `email/send-leave/` | `{success, ...}` | ⏳ |
| POST | `email/send-notification/` | `{success, ...}` | ⏳ |

**`<File>`**: `id, createdAt, updatedAt, name, mimeType, size, workspaceId, projectId, uploadedBy, bucketId, url`

---

## Phase 11 — Integrations

| Collection | CRUD | Resource fields | Parity |
|---|---|---|---|
| `github_integrations` | L/C/R/U/D | `…, projectId, repoOwner, repoName, accessToken(write-only), webhookSecret, autoUpdateStatus, enabledEvents` | ⏳ |
| `gitlab_integrations` | L/C/R/U/D | `…, projectId, projectPath, accessToken(write-only), webhookSecret, autoUpdateStatus, enabledEvents` | ⏳ |
| `discord_integrations` | L/C/R/U/D | `…, projectId, webhookUrl, enabledEvents` | ⏳ |
| `git_commits` | L/C/R/U/D | `…, projectId, provider, commitSha, message, author, authorEmail, timestamp, linkedTaskIds, url` | ⏳ |
| POST | `integrations/*/webhook/` (**new**, D-fix) | verify + enqueue (`git` queue) | ➕ |

---

## Phase 12 — Generation

| Method | Path | Django response | Parity |
|---|---|---|---|
| POST | `bulk-save/` | `201 {success:true, clientRequirements[], epics[], functionalRequirements[], tasks[]}` (each `{id, hierarchyId, …}`) | ⏳ |

---

## WebSocket

| Path | Django (Channels) | Nest target | Parity |
|---|---|---|---|
| `ws/collections/` | subscribe/unsubscribe by channel; frame `{event,payload,channels,timestamp}` | **raw WS** (matches native-WebSocket frontend), identical frame, **workspace-filtered broadcast** (closes D2), Prisma write-hook CRUD events + Redis fan-out | 🚧 |

> **Phase 7 notes:** cookie-auth on connect (anonymous → close 4401); CRUD events come from a central Prisma write hook (replaces the Django signal); `RealtimeSubscriber` bridges business events (member-added, invitation-accepted, join-approved, sprint-completed). Payload is best-effort (frontend refetches, A§7.1). Commit-gating for the few transactional writes is a documented follow-up (write hook fires per-op).

---

## New endpoints (no Django equivalent)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `health/` | liveness/readiness (DB+Redis) | ➕ done |
| GET | `/api/docs` | Swagger UI (replaces drf-spectacular) | ➕ done |

---

### How to update this ledger
For each endpoint as its phase lands: (1) run the characterization test vs Django, (2) implement in Nest, (3) run the contract test vs Nest, (4) flip the row to ✅ with the contract-test name. The phase is not **Done** (its `PHASE_N.md`) until all its rows are ✅.
