# Current System Audit — L‑T‑Connect Django Backend

> **Status:** Authoritative source-of-truth audit of the existing backend, as implemented on branch `main`.
> **Scope:** `backend/` Django project only. No redesign. Every statement below is traceable to source.
> **Audience:** Architects/engineers preparing the NestJS re-platform. This document is the *input* to the Migration Matrix and the replacement architecture; nothing in the new design may introduce capabilities that are not grounded here.
> **Generated:** 2026-06-30.

---

## 1. Executive Summary

L‑T‑Connect's backend is a **Django 5.1 + Django REST Framework** monolith that exposes a **generic, collection-oriented REST API** consumed by a Next.js frontend. The backend was deliberately built as a *thin, uniform persistence-and-broadcast layer*: almost every domain resource is a `ModelViewSet` over a `TimestampedModel`, serialized through a shared camelCase serializer base, scoped by workspace membership, and mirrored to clients over WebSockets via a single global Django-signal broadcaster.

**Defining characteristics:**

1. **Thin CRUD over fat models.** 17 Django apps, ~33 models, but almost no server-side business logic. Workflows (leave approval, attendance hour computation, timer start/stop, kanban moves, Git sync) are expressed as field writes from the frontend, not as server transactions or state machines.
2. **A "native API" convention layer** in `apps.core` is the real architecture: a base model (string PKs), a base serializer (snake↔camel), a generic query filter, a pagination envelope, an error envelope, and a workspace-scoping base viewset. Every domain app is a near-trivial subclass.
3. **Soft foreign keys everywhere.** Cross-domain relationships (task→epic, task→sprint, FR→epic, etc.) are stored as bare `CharField` IDs with **no database referential integrity**. Only "structural" parents (workspace, project, owner, created_by) are real FKs.
4. **Realtime is a global firehose.** One `post_save`/`post_delete` receiver broadcasts *every* model tagged with a `REALTIME_COLLECTION` attribute to collection-wide WebSocket groups that **any authenticated user may join** — a cross-workspace data-exposure and over-broadcast issue.
5. **Celery is configured but entirely unused.** There is not a single `tasks.py` / `@shared_task` in the codebase. Email — the only "async" work — is sent **synchronously inline** inside request handlers via a blocking HTTP call to Resend.
6. **Authorization is membership-only.** Despite a `WorkspaceRole`/`permissions` data model and a 7-value user `role` enum, there is **no role- or permission-based enforcement** anywhere. Any active member of a workspace can read and write virtually every resource in it.

**Overall posture:** The system is internally consistent and easy to reason about, but it has pushed correctness, authorization, and integrity concerns out of the backend. The re-platform's central opportunity is to **move business rules, authorization, integrity, and async work back into the server** while preserving the camelCase REST + collection-WS contract the frontend depends on.

---

## 2. Methodology & Scope

- **Read in full:** project config (`config/`), the `apps.core` convention layer, and every app's `models.py`, `serializers.py`, `viewsets.py`/`views.py`, `urls.py`, plus realtime (`consumers/routing/signals/auth`), emails (`service/views`), and representative migrations.
- **Frontend contract** (`frontend/src/lib/api/*`) was read only to document the wire contract the backend must preserve (camelCase fields, pagination/error envelopes, cookie-JWT, collection slugs, WS frame shape).
- **Out of scope:** frontend feature logic, the `venv/` vendored packages, and any redesign.

**App inventory (17 local apps):** `core`, `accounts`, `workspaces`, `realtime`, `projects`, `requirements`, `epics`, `sprints`, `tasks`, `attendance`, `leave`, `notifications`, `time_tracking`, `integrations`, `activity`, `files`, `emails`.

---

## 3. Runtime Topology

| Process | Entry point | Purpose | Status |
|---|---|---|---|
| HTTP/WSGI | `config/wsgi.py` | Standard sync HTTP | Defined |
| ASGI (Daphne) | `config/asgi.py` | HTTP + WebSocket (Channels) | Primary; `daphne` is first in `INSTALLED_APPS` |
| WebSocket | `ProtocolTypeRouter` → `JWTCookieAuthMiddlewareStack` → `URLRouter` | `/ws/collections/` realtime | Active |
| Celery worker | `config/celery.py` (`app.autodiscover_tasks()`) | Async jobs | **Configured but 0 tasks — effectively dead** |
| Redis | `REDIS_URL` | Channels layer **and** Celery broker/result backend (same instance, db 0) | Active (Channels), unused (Celery) |
| PostgreSQL | `DATABASE_URL` | Primary store | Active |
| Object storage | `django-storages[s3]` (optional, `USE_S3`) | File blobs; else local `MEDIA_ROOT` | Conditional |
| Resend (HTTP) | `apps.emails.service` | Transactional email; Django `send_mail` fallback | Active, **synchronous** |

**Settings layering:** `config/settings/base.py` ← `dev.py` (DEBUG, `ALLOWED_HOSTS=["*"]`) / `prod.py` (HSTS, secure cookies, proxy SSL header). `manage.py` and both `asgi/celery` default to `config.settings.dev`. **No `test.py`.** Secrets/config via `django-environ` + `.env`.

**Dependencies (`pyproject.toml`):** Django 5.0–5.2, DRF ≥3.15, SimpleJWT, django-filter (declared, **not used** — replaced by custom filter), channels + channels-redis + daphne, celery + redis, psycopg3, django-storages[s3], Pillow, drf-spectacular. Dev: ruff, ipython. Python ≥3.11.

---

## 4. The `apps.core` Convention Layer (the real architecture)

Every domain app inherits its behavior from `core`. Understanding these six primitives is understanding ~80% of the backend.

### 4.1 `TimestampedModel` (`core/models.py`)
Abstract base for **every** domain model.
- **PK:** `id = CharField(max_length=36, default=generate_native_id)` where `generate_native_id()` returns a **20-char `secrets.choice` alphanumeric string** (not UUID, not auto-increment). Non-sortable, non-sequential, opaque public IDs.
- `created_at` (`auto_now_add`), `updated_at` (`auto_now`).
- `Meta.ordering = ["-created_at"]` (global newest-first default).

> **Migration-critical:** All IDs are random 20-char strings. Prisma must model these as `String @id` with an app-generated default; an int/UUID switch would break every stored soft-FK and every frontend cache key.

### 4.2 `NativeModelSerializer` (`core/serializers.py`)
- On output: stringifies `id`, renames `created_at`→`createdAt`, `updated_at`→`updatedAt`.
- On input: strips `createdAt`/`updatedAt`.
- All other camelCase mapping is done **per-field, by hand**, in each domain serializer (`source="snake_case"`). There is no automatic global camelCase transform — every field rename is explicit and duplicated across ~30 serializers.

### 4.3 `CamelCaseQueryFilter` (`core/filters.py`) — the only filter backend
A bespoke generic filter applied to all list endpoints. Translates frontend query params to ORM lookups:
- camelCase → snake_case field resolution; `id/createdAt/updatedAt` aliases; `*_id` FK shorthand.
- Lookup suffixes via `__`: `ne` (→ exclude exact), `lt/lte/gt/gte`, `icontains/istartswith/iendswith`, `isnull`, `not_in`, and implicit `in` (multi-value or comma-joined).
- `ordering=field,-field` with camel translation.
- `or_filter()` helper for the rare OR query.

> This **is** the "Search" feature for most resources — there is no dedicated search service. Risk: arbitrary field filtering with thin guarding (resolves against `model._meta` fields), value coercion only for booleans, no allowlist per resource.

### 4.4 `NativePagination` (`core/pagination.py`)
`PageNumberPagination`; `pageSize` query param (default 100, max 1000). Envelope: `{ items, total, page, pageSize }`.

### 4.5 `api_exception_handler` (`core/exceptions.py`)
Wraps all DRF exceptions into `{ "error": { message, code, type } }`. The frontend `rest-client.ts` unwraps `data.error.message`.

### 4.6 `WorkspaceScopedModelViewSet` (`core/viewsets.py`) — the base for nearly every endpoint
- `permission_classes = [IsAuthenticated]`, `lookup_field = "id"`.
- `get_queryset()`: if a model has a `workspace`/`workspace_id` field, it (a) optionally filters by a `workspaceId`/`workspace_id` query param and (b) **auto-restricts to the caller's `ACTIVE` `WorkspaceMember` workspace IDs**, unless the user `is_superuser` or `is_admin_flag`.
- **This is the entire authorization model for domain resources.** There is no per-object owner check, no role check, no write-vs-read distinction. Membership in the workspace ⇒ full CRUD.

### 4.7 `core/permissions.py` (defined, **barely used**)
`IsWorkspaceMember` and `IsOwnerOrReadOnly` exist but are **not referenced** by any viewset (`grep` shows no imports). Dead/aspirational code.

### 4.8 `core/middleware.py` — `JWTCookieMiddleware`
Copies the access-token cookie into `HTTP_AUTHORIZATION: Bearer …` before auth middleware runs, so header- and cookie-based JWT both work.

### 4.9 `core/bulk_views.py` — `BulkSaveView` (the "AI" endpoint)
`POST /api/v1/bulk-save/`. The only substantial server-side business logic in the codebase. Accepts an AI-`generated` payload and transactionally materializes a **CR → Epic → FR → Task** tree, computing hierarchy IDs (`PROJ-CRC-EPC-FRC-01`, child FRs as `parent.NN`), round-robin linking children to parents, classifying FRs as TECHNICAL/FUNCTIONAL by keyword. Authorizes on workspace membership (admin bypass). ~230 lines, all in one view function.

---

## 5. Authentication & Authorization (deep dive)

### 5.1 User model (`accounts/models.py`)
`User(AbstractBaseUser, PermissionsMixin, TimestampedModel)`:
- `email` (unique, `USERNAME_FIELD`), `name`, `phone`, `avatar`, `role` (7-value enum: MANAGER, ASSISTANT_MANAGER, SOFTWARE_DEVELOPER, DEVELOPER_INTERN, TESTER, CONTENT_ENGINEER, MEMBER), `workspace_id` (denormalized *default* workspace), `status`, `has_temp_password`, `is_admin_flag` (platform admin, **distinct from** `is_superuser`), `is_active`, `is_staff`.
- `PermissionsMixin` brings `groups`/`user_permissions` tables that are **unused** by app logic (only surfaced in the admin).
- `UserManager` (`managers.py`): standard email-based create_user/superuser; unusable password if none.

### 5.2 Token model
SimpleJWT, **cookie-based**:
- `ACCESS_TOKEN_LIFETIME` 15 min, `REFRESH_TOKEN_LIFETIME` 7 days, `ROTATE_REFRESH_TOKENS=True`, `BLACKLIST_AFTER_ROTATION=True` (+ `token_blacklist` app installed).
- Cookies `lt_access` / `lt_refresh`, httpOnly, SameSite=Lax (configurable), Secure in prod.
- `JWTCookieAuthentication` (DRF) reads the cookie when no `Authorization` header is present.

### 5.3 Auth endpoints (`accounts/views.py`, all `APIView`)
| Endpoint | Behavior | Notes |
|---|---|---|
| `POST auth/login/` | `authenticate()` → issue tokens → set cookies; returns `{user, sessionId: jti}` | |
| `POST auth/logout/` | Blacklists refresh, deletes cookies | |
| `POST auth/refresh/` | Reads refresh cookie, **manually** `set_jti()`+`set_exp()`, re-issues cookies | ⚠ **Does not blacklist the old token.** Bypasses SimpleJWT's rotation/blacklist flow — the rotation/blacklist settings (5.2) never take effect. Refresh tokens are effectively non-revocable until natural expiry. |
| `GET auth/me/` | Returns user + session + workspaceIds + flags | Queries `WorkspaceMember` (no `status` filter here — inconsistent with other call sites that filter `ACTIVE`). |
| `POST auth/change-password/` | Verifies current, sets new, clears `has_temp_password` | |
| `PATCH auth/profile/` | Self name/phone/avatar | |
| `POST auth/register/` | Self-service signup → tokens | `validate_password` enforced. |
| `POST auth/password-reset/` + `/confirm/` | Django `PasswordResetTokenGenerator`; emails link; constant-time response | Reset email sent **inline**, best-effort. |
| `POST users/invite/` (`InviteUserView`) | Existing user → add membership; new user → create w/ temp password + welcome email | ⚠ **Authorization gap:** any **active member** (or owner/platform-admin) may invite; no manager/admin role gate. Temp password generated server-side, emailed. |

### 5.4 User directory (`accounts/viewsets.py`)
`UserViewSet` (Retrieve/List/Update only): lists users sharing ≥1 workspace with the caller (peers), or all users for platform admins. Update restricted to self (or admin). Two queries to compute peers (workspaces → members) — N+1-ish but bounded.

### 5.5 Authorization model — findings
- **No RBAC enforcement.** `role`, `WorkspaceRole.permissions`, `WorkspaceMember.role` are **data only**. No guard, decorator, or check consults them. The only privilege boundaries are: `IsAuthenticated`, workspace membership (via base viewset), `is_superuser`/`is_admin_flag` bypass, and a handful of ad-hoc `if` checks (invite, bulk-save, self-update).
- **`WorkspaceMember.role` is a free `CharField`** (default `MEMBER`), not an FK to `WorkspaceRole`, so custom roles and member roles are not linked.
- **Write authorization = read authorization.** Any member can `PATCH`/`DELETE` any in-scope row, including approving their own leave (`status="APPROVED"`), approving their own time entries, changing others' tasks, deleting workspace members, etc. The "approval" workflows are unguarded field writes.

---

## 6. Domain App Catalog

> Conventions for the table: **FK** = real Django ForeignKey (DB integrity). **soft** = `CharField` ID with no integrity. **RT** = has `REALTIME_COLLECTION` (broadcast). All models extend `TimestampedModel` (string PK + timestamps). All viewsets are `WorkspaceScopedModelViewSet` (full CRUD) unless noted.

### 6.1 `workspaces` — workspaces, membership, RBAC data, invitations, join requests
| Model | Key fields | Relations | RT | Notes |
|---|---|---|---|---|
| `Workspace` | name, description, logo, color, invite_code (unique), settings(JSON) | owner **FK PROTECT** | ✓ | `perform_create` sets owner + auto-creates `MANAGER` membership |
| `WorkspaceMember` | role (free str), status (ACTIVE/PENDING/INACTIVE), joined_at | workspace FK CASCADE, user FK CASCADE; `unique(workspace,user)` | ✓ | The membership/scoping table the whole system pivots on |
| `WorkspaceRole` | name, permissions(JSON list) | workspace FK; `unique(workspace,name)` | ✗ | **Custom roles defined but never enforced** |
| `InviteCode` | code (unique), role, max_uses, used_count, expires_at | workspace FK, created_by FK PROTECT | ✗ | No redemption endpoint/counter logic server-side |
| `EmailInvitation` | email, role, token (unique), status, expires_at | workspace FK, invited_by FK PROTECT | ✗ | No accept-token endpoint server-side |
| `JoinRequest` | message, status (PENDING/APPROVED/REJECTED) | workspace FK, user FK, handled_by FK SET_NULL; `unique(workspace,user)` | ✗ | **No approve/reject action** — status set via PATCH |
| `PendingWorkspaceAccess` | requested_role | workspace FK, user FK | ✗ | Overlaps conceptually with JoinRequest |

**Workflow reality:** All of invitation acceptance, code redemption, join-request approval, and member role changes are **client-driven CRUD on these tables**. The server provides no orchestration, no transactional side effects, no notification emission.

### 6.2 `projects`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `Project` | name, short_code, description, client_name, methodology, status(5), archived, start/end_date, member_ids(JSON), project_settings(JSON) | workspace FK, owner FK PROTECT, created_by FK PROTECT; `Index(workspace,status)` | ✓ |

`member_ids` is a JSON array of user IDs (denormalized membership, parallel to `WorkspaceMember`).

### 6.3 `requirements`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `ClientRequirement` | title, description, client_name, priority(4), status(6), attachments(JSON) | workspace FK, project FK, created_by FK | ✓ |
| `FunctionalRequirement` | hierarchy_id, title, complexity(4), priority, status(6), progress, reusable, assigned_to(JSON), assigned_to_names(JSON), **tags (Text CSV)**, **linked_project_ids (Text CSV)** | workspace FK, project FK, created_by FK; `epic_id`/`sprint_id`/`client_requirement_id` **soft**; `Index(project,epic_id)`,`Index(hierarchy_id)` | ✓ |

### 6.4 `epics`
| `Epic` | hierarchy_id, name, description, color, start/end_date, status(3), progress, assigned_team | workspace FK, project FK, created_by FK; `requirement_id` **soft** | ✓ |

### 6.5 `sprints`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `Sprint` | name, goal, start/end_date, status(3), retrospective_notes | workspace FK, project FK, created_by FK; `Index(project,status)` | ✓ |
| `Retrospective` | went_well/needs_improvement/action_items (JSON) | sprint FK, workspace FK, project FK, created_by FK | ✓ |

### 6.6 `tasks` (the fat domain)
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `Task` | hierarchy_id, title, description, status(5), priority(4), assignee_ids/assigned_to/assigned_to_names/watcher_ids (JSON), assigned_by(+name), due_date, estimated/actual_hours, labels(JSON), attachments(JSON), custom_fields(JSON), position(float), blocked_by/blocks (JSON) | workspace FK, project FK, created_by FK; `sprint_id`/`epic_id`/`functional_requirement_id`/`parent_task_id` **soft**; `Index(project,status)`,`(sprint_id)`,`(hierarchy_id)` | ✓ |
| `TaskComment` | content, mentions(JSON), attachments(JSON) | task FK CASCADE, user FK CASCADE | ✓ |
| `KanbanColumn` | name, status, wip_limit, position(float), color | project FK | ✓ |
| `Label` | name, color, description | workspace FK, project FK (nullable) | ✓ |

**Subtasks** = self-reference via soft `parent_task_id`. **Kanban move** = PATCH `status`+`position`. **Labels** are *both* a `Label` catalog *and* a denormalized JSON array on `Task` (`labels`). **Blockers** (`blocked_by`/`blocks`) are JSON arrays — no edge table, no cycle protection, bidirectional consistency is the client's job.

### 6.7 `attendance`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `Attendance` | date, check_in_time, check_out_time, work_hours, status(6), late_minutes, location, notes, is_weekend, is_holiday | workspace FK, user FK, created_by FK SET_NULL; `unique(workspace,user,date)`, `Index(workspace,date)` | ✓ |
| `Holiday` | name, date, is_optional, description | workspace FK; `unique(workspace,date,name)` | ✓ |

**No check-in/check-out actions.** `work_hours`, `late_minutes`, `status` are computed by the frontend and posted. Pure CRUD viewsets.

### 6.8 `leave`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `LeaveRequest` | type(10), start/end_date, reason, status(4), approved_by(str), approved_at, rejection_reason, days_count | workspace FK, user FK, created_by FK PROTECT | ✓ |
| `LeaveBalance` | year, paid_leave, unpaid_leave, half_day, comp_off | workspace FK, user FK; `unique(workspace,user,year)` | ✓ |

**No approval workflow, no balance deduction, no overlap validation.** `days_count` computed client-side (`frontend/src/lib/leave-utils.ts`). Approval = PATCH `status`/`approved_by`. Migration `0002` expanded the type enum from 3→10 values.

### 6.9 `time_tracking`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `TimeEntry` | denormalized user_name/email, task/project denorm fields, start/end_time, duration(min), is_billable, billable_rate, type(MANUAL/TIMER/POMODORO), status(PENDING/APPROVED/REJECTED), approval fields, tags(JSON) | workspace FK, user FK, created_by FK PROTECT; `task_id`/`project_id` **soft**; indexes | ✓ |
| `ActiveTimer` | task/project denorm, start_time, is_paused, paused_at, total_paused_time, type, pomodoro_settings(JSON) | **user OneToOne** — *no workspace field* | ✓ |

**No start/stop/pause actions.** Timer lifecycle is CRUD on `ActiveTimer`; `duration` and approvals are client-computed. ⚠ `ActiveTimer` has **no workspace field**, so `WorkspaceScopedModelViewSet` does **not** scope it — its `get_queryset` returns *all* active timers to any authenticated user (read exposure).

### 6.10 `notifications`
| `Notification` | type, title, message, project_id(soft), related_entity_id/type, is_read | workspace FK, user FK; `Index(user,is_read)`,`(workspace,-created_at)` | ✓ |
- **Only custom action in the domain layer:** `POST notifications/mark_all_read/` (bulk `update(is_read=True)` for the caller).
- Notifications are **created by the frontend** via POST; no server-side notification engine reacts to domain events.

### 6.11 `activity`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `ActivityLog` | action, entity_type, entity_id(soft), changes(JSON), metadata(JSON) | workspace FK, user FK; `Index(workspace,-created_at)`,`(entity_type,entity_id)` | ✓ |
| `SavedSearch` | name, query, filters(JSON) | workspace FK, user FK | ✓ |

⚠ **Activity logs are written by the client**, not by signals/middleware. There is no server-side audit guarantee — a write that bypasses the frontend leaves no trail. "Search" = `SavedSearch` storage + the generic query filter; there is no search index/engine.

### 6.12 `integrations`
| Model | Key fields | Relations | RT |
|---|---|---|---|
| `GitHubIntegration` | repo_owner, repo_name, **access_token (plaintext TextField)**, webhook_secret, auto_update_status, enabled_events(JSON) | project **OneToOne** | ✓ |
| `GitLabIntegration` | project_path, **access_token (plaintext)**, … | project OneToOne | ✓ |
| `DiscordIntegration` | webhook_url, enabled_events | project OneToOne | ✓ |
| `GitCommit` | provider, commit_sha, message, author(+email), timestamp, linked_task_ids(JSON), url | project FK; `unique(project,commit_sha)` | ✓ |

⚠ **No webhook receivers, no Git/Discord API calls, no auto-status logic exist.** Integrations are config + commit records stored via CRUD; the actual integration behavior is absent server-side. **Tokens are stored in plaintext** (comment acknowledges "encrypt in prod"; not done). Serializers mark `accessToken` `write_only` (not echoed), but the models have **no `workspace` field**, so these viewsets are **not workspace-scoped** → cross-workspace listing of integration configs/commits by any authenticated user.

### 6.13 `files`
| `UploadedFile` | name, file (FileField), mime_type, size, **workspace_id (soft)**, project_id(soft), bucket | uploaded_by FK SET_NULL | ✓ |
- Custom `ModelViewSet` (not the workspace base). Multipart `create` (accepts optional explicit `id`), streaming actions `preview`/`view`/`download` (`FileResponse`, inline/attachment), `perform_destroy` deletes the blob then row.
- `get_queryset` scopes to the caller's active-workspace IDs **plus `""`** (workspace-less files visible to all). Local `MEDIA_ROOT` or S3 by `USE_S3`.

### 6.14 `emails`
- `service.py`: `_resend_send()` posts to Resend over HTTPS (`requests`, 10 s timeout); falls back to Django `send_mail` when no API key. Helpers: workspace invitation, leave notification, generic notification, welcome (temp password), password reset.
- `views.py`: `POST email/send-invitation|send-leave|send-notification` — authenticated passthroughs the frontend calls to send mail.
- ⚠ **All synchronous, in-request.** A slow/failed Resend call blocks the HTTP worker; failures are swallowed/logged best-effort.

---

## 7. Realtime Architecture (deep dive)

The single most important — and most fragile — subsystem.

### 7.1 Mechanism
- **Broadcaster (`realtime/signals.py`):** module-level `@receiver(post_save)` and `@receiver(post_delete)` on **all senders**. If `instance.REALTIME_COLLECTION` is set, it `async_to_sync(group_send)` to groups `rt_<collection>` and `rt_<collection>_<pk>` with `{event: "<collection>.<create|update|delete>", payload, channels}`.
- **Consumer (`realtime/consumers.py`, `CollectionConsumer`):** rejects anonymous (close 4401); accepts `{action: subscribe|unsubscribe, channels: [...]}`; joins/leaves the corresponding groups; relays `collection_event` frames to the socket with an added `timestamp`.
- **WS auth (`realtime/auth.py`):** custom Channels middleware parses the `lt_access` cookie and resolves `scope["user"]` via SimpleJWT (no `?token=` accepted — deliberate).
- **Client (`frontend/.../realtime-client.ts`):** one shared socket to `/ws/collections/`, ref-counted channel subscriptions, exponential-backoff reconnect; routes frames to subscribers by channel membership. The frontend subscribes to whole collections (e.g. `tasks`) and per-id channels (`tasks.<id>`) to invalidate TanStack Query caches.

### 7.2 Findings (severity-ranked)
1. **🔴 No subscription authorization.** Any authenticated user may `subscribe` to any collection channel (`tasks`, `notifications`, `leave_requests`, …). The broadcaster sends each event to the **collection-wide** group, so **every subscriber receives every workspace's events for that collection**, including full record payloads. Cross-workspace/PII data exposure (leave reasons, attendance, time entries, notifications addressed to others).
2. **🟠 Payload shape diverges from REST.** `_safe_serialize` skips **all relations** (so `workspace_id`, `project_id`, `owner`, FK ids are **absent**) and emits a different camelCase than the DRF serializers. Clients often can't even tell which workspace/parent an event belongs to; the frontend mostly uses the event only to trigger a refetch.
3. **🟠 Broadcast fires pre-commit, inside the transaction.** `post_save` runs before `transaction.on_commit`; a subsequent rollback still broadcast a phantom event. Should be commit-gated.
4. **🟡 Synchronous fan-out in the request path.** `async_to_sync(group_send)` runs inline on every write × 2 groups, adding Redis round-trips to write latency; `bulk_save` creating a whole tree emits a storm of individual events.
5. **🟡 Global signal coupling.** A single receiver bound to *all* models is implicit, hard to test, and silently governs which models are "realtime" via a magic attribute.

---

## 8. Background Processing & Scheduled Jobs

- **Celery:** broker + result backend = Redis (`config/celery.py`, settings), `autodiscover_tasks()` enabled. **There are zero task definitions** in the project (`grep` for `tasks.py`/`@shared_task`/`@app.task` → nothing in `apps/`). No beat schedule, no periodic jobs, no worker-side reminders/deadline checks/AI/integration sync.
- **Consequence:** Every "background-shaped" capability named in the re-platform brief (emails, notifications, reminders, AI, integrations, scheduled jobs, attendance/deadline jobs) is currently **either synchronous-inline (email) or nonexistent**. The migration's queue layer is **greenfield**, not a port.

---

## 9. Data Model Analysis

### 9.1 Identity & keys
- Random 20-char string PKs across all tables. No natural sort; `ordering=-created_at` everywhere.
- Uniqueness constraints present where it matters: `User.email`, `Workspace.invite_code`, `(workspace,user)` membership, `(workspace,user,date)` attendance, `(workspace,user,year)` balance, `(project,commit_sha)`, `(workspace,name)` role, invitation/code tokens.

### 9.2 Referential integrity (the core integrity gap)
**Real FKs (integrity enforced):** workspace, project, owner, created_by, user, task↔comment, sprint↔retrospective, project↔integration.
**Soft FKs (no integrity, `CharField`):** `epic_id`, `sprint_id`, `client_requirement_id`, `functional_requirement_id`, `parent_task_id`, `requirement_id`, `project_id` (in time_tracking/notifications/files), `task_id`, `entity_id`, `related_entity_id`. These can dangle, point cross-project, or be `""`.

> **Design intent vs. cost:** soft FKs decouple apps and ease the AI bulk-generator's ordering, but they push integrity to the client and make cascade/orphan handling impossible at the DB. The Prisma redesign can promote most of these to real relations with explicit cascade rules.

### 9.3 Denormalization & arrays
- `*_name` snapshots (`created_by_name`, `assigned_to_names`, `user_name`, `task_title`, `project_name`) duplicate joinable data to avoid joins/serializer lookups; they drift when source records change.
- `JSONField` arrays for membership/assignees/watchers/labels/blockers; `TextField` CSV for `tags`/`linked_project_ids` (worst case — string parsing).
- `Project.member_ids` (JSON) parallels `WorkspaceMember`; `Task.labels` (JSON) parallels `Label`.

### 9.4 Indexing
Reasonable composite indexes exist on the hot paths (`(workspace,status)`, `(project,status)`, `(workspace,-created_at)`, `(user,is_read)`, `(workspace,date)`, soft-FK lookups on `sprint_id`/`hierarchy_id`). Gaps: soft-FK columns frequently filtered (`epic_id` on tasks, `functional_requirement_id`) are only partially indexed; the generic filter can drive unindexed scans on arbitrary fields.

---

## 10. End-to-End Business Workflows (as actually implemented)

| Workflow | Server-side implementation | Where the logic actually lives |
|---|---|---|
| **Login/refresh/logout** | Full (cookie JWT); refresh non-revoking (§5.3) | Backend |
| **Signup / invite / temp password** | `InviteUserView` + email; member auto-add | Backend (single view) |
| **Join workspace (code / request / email invite)** | CRUD rows only; **no redemption/accept/approve logic** | **Frontend** |
| **AI generation → persist tree** | `BulkSaveView` (transactional CR→Epic→FR→Task, hierarchy IDs) | Backend (one view) |
| **AI generation itself (LLM call)** | **Not in backend** — frontend calls the model; backend only persists | Frontend |
| **Kanban move / reorder** | PATCH `status`+`position` | Frontend |
| **Subtasks / blockers / watchers** | Soft IDs + JSON arrays via PATCH | Frontend |
| **Leave request → approve → balance** | CRUD; status/approved_by via PATCH; balance not deducted | **Frontend** (`leave-utils.ts`) |
| **Attendance check-in/out → hours** | CRUD; hours/late/status posted | **Frontend** |
| **Time tracking start/stop/approve** | CRUD on TimeEntry/ActiveTimer; duration posted | **Frontend** |
| **Notifications** | CRUD + `mark_all_read`; created by client | **Frontend** |
| **Activity/audit log** | CRUD; written by client | **Frontend** |
| **Git/GitLab/Discord integration** | Config + commit rows only; **no webhooks/API calls** | **Absent** |
| **Email send** | Synchronous inline (Resend/Django) | Backend (blocking) |
| **Realtime sync** | Global signal → collection broadcast | Backend (unauthorized fan-out) |
| **Search / analytics** | Generic query filter + SavedSearch storage | **Frontend** (no engine) |

---

## 11. Technical Debt Register

| # | Item | Type | Impact | Sev |
|---|---|---|---|---|
| D1 | Refresh endpoint never blacklists rotated tokens; SimpleJWT rotation/blacklist config is dead | Security | Stolen refresh tokens valid 7 days; no revocation | 🔴 |
| D2 | WS subscriptions unauthorized; collection-wide broadcast | Security/Privacy | Cross-workspace data leak incl. PII | 🔴 |
| D3 | No RBAC/permission enforcement; member = full CRUD; self-approval possible | Security | Privilege boundaries absent | 🔴 |
| D4 | Integration access tokens stored plaintext | Security | Credential disclosure if DB leaks | 🔴 |
| D5 | `ActiveTimer` & all `integrations` models lack `workspace` → not scoped | Security | Cross-workspace read of timers/integration configs/commits | 🟠 |
| D6 | Soft foreign keys throughout | Integrity | Orphans, dangling refs, no cascades | 🟠 |
| D7 | Email sent synchronously in request path | Reliability/Perf | Worker blocking, lost mail on failure | 🟠 |
| D8 | Celery configured but unused; no async/scheduled jobs | Capability gap | Reminders/deadlines/integration sync impossible | 🟠 |
| D9 | Business rules (leave/attendance/time/kanban) live in frontend | Correctness | Server can't enforce invariants; any API client bypasses rules | 🟠 |
| D10 | Realtime payload omits relations & diverges from REST; pre-commit fan-out | Correctness | Phantom events, unusable payloads | 🟠 |
| D11 | Generic filter allows arbitrary field filtering w/o per-resource allowlist | Security/Perf | Information probing, unindexed scans | 🟡 |
| D12 | Denormalized `*_name`/`member_ids`/`labels` snapshots drift | Data quality | Stale displayed data | 🟡 |
| D13 | CSV `TextField`s (`tags`, `linked_project_ids`) | Modeling | String parsing, no integrity | 🟡 |
| D14 | `JoinRequest` vs `PendingWorkspaceAccess` redundancy | Modeling | Two overlapping access-request paths | 🟡 |
| D15 | `IsWorkspaceMember`/`IsOwnerOrReadOnly` defined but unused; `django_filter` declared but unused | Dead code | Confusion | 🟢 |
| D16 | No test suite (no `test*.py`, no `test.py` settings) | Quality | No regression safety net for migration | 🟠 |
| D17 | `auth/me` queries membership without `status="ACTIVE"` filter (inconsistent with base viewset) | Consistency bug | INACTIVE memberships leak into `workspaceIds` | 🟡 |
| D18 | `bulk_save` ~230-line view; classification keywords inline | Maintainability | Hard to test/extend | 🟡 |

### 11.1 Coupling & duplication
- **Convention coupling (healthy):** every app depends on `apps.core` (base model/serializer/viewset/filter). Clean, intentional.
- **Cross-app imports (lazy):** `core.viewsets`, `core.bulk_views`, `accounts.*` import `workspaces.models` (often lazily inside functions to dodge cycles) — a sign of a missing shared membership/authorization service.
- **Serializer duplication:** ~30 serializers each restate identical camel↔snake mappings, `createdBy`/`createdByName` read-only patterns, JSON passthroughs. No DRY beyond the tiny base.
- **`perform_create` duplication:** the `created_by`/`created_by_name` stamping pattern is copy-pasted across ~10 viewsets (only `requirements` factored a `_CreatorMixin`).

### 11.2 Performance concerns
- Per-write synchronous WS fan-out (2 Redis sends/write; storms on bulk_save).
- `get_queryset` issues a `WorkspaceMember` subquery on **every** domain request (no caching of membership).
- `UserViewSet` peer computation = 2 queries; serializers' `SerializerMethodField`s (`memberIds`, `workspaceIds`) issue extra per-object queries (N+1 on list endpoints).
- Generic filter can produce unindexed scans; no query-cost guardrails.
- No caching layer (Redis used only for Channels); `PAGE_SIZE=100`, `max_page_size=1000`.

---

## 12. Feature Coverage vs. Re-platform "Preserve" List

| Capability (brief) | Backend reality today |
|---|---|
| Auth, Users, Workspaces | ✅ Implemented (cookie JWT, directory, workspace CRUD) |
| Roles & Permissions (RBAC) | ⚠ **Data only**, no enforcement |
| Invitations, Join Requests | ⚠ **CRUD models only**, no server workflow |
| Projects, Requirements, FRs, Epics, Sprints, Tasks, Subtasks, Kanban, Labels, Comments | ✅ Models + CRUD; workflow logic client-side |
| Activity Logs | ⚠ Client-written, no server audit |
| Notifications | ⚠ CRUD + mark-all-read; client-created, no engine |
| Attendance, Leave, Time Tracking | ⚠ CRUD; **all computation/approval client-side** |
| File Uploads | ✅ Implemented (storage + streaming) |
| GitHub/GitLab/Discord Integrations | ⚠ **Config/records only**; no webhooks or API calls |
| AI | ⚠ **Persistence only** (`bulk_save`); LLM call is frontend |
| Analytics, Search | ⚠ **No engine**; generic filter + saved searches |
| Email | ✅ Implemented but **synchronous** |
| Real-time Updates | ⚠ Works but **unauthorized fan-out** |

**Takeaway for the redesign:** "preserve every business capability" mostly means **preserve the data shapes and the REST/WS contract**, then *add the missing server-side behavior* (RBAC enforcement, workflow transactions, async jobs, integration webhooks, scoped realtime) that the brief assumes exists but currently does not.

---

## 13. Migration Risks

| Risk | Why | Mitigation for NestJS phase |
|---|---|---|
| **Contract drift** | Frontend hard-codes camelCase fields, `{items,total,page,pageSize}`, `{error:{message,code,type}}`, cookie names `lt_access/lt_refresh`, collection slugs, WS frame `{event,payload,channels,timestamp}` | Treat the contract as frozen; build a contract test suite from `frontend/src/lib/api/*` before porting |
| **String PK preservation** | Soft FKs and frontend caches key on 20-char string IDs | Keep `String @id` with app-generated 20-char default; migrate data verbatim |
| **Soft-FK promotion** | Turning soft IDs into real relations may expose pre-existing orphans/`""` values | Data-quality pass + nullable relations + backfill before enforcing |
| **Realtime semantics** | Frontend expects collection + per-id channels and uses events as refetch triggers | Preserve channel names/frame shape **but** add room authorization; payload can stay minimal |
| **No tests / no test settings** | Nothing guards behavior parity | Characterization tests against the running Django API per module before/after |
| **Behavioral parity for client-side logic** | Moving leave/attendance/time math server-side can change results the frontend currently produces | Port the exact `leave-utils.ts`/attendance formulas; reconcile, then switch source of truth |
| **Hidden auth bypasses** | `is_superuser`/`is_admin_flag` shortcuts, `workspace=""` visibility, unscoped models | Enumerate and reproduce each bypass deliberately (don't silently "fix" during port) |
| **Refresh/blacklist change** | Fixing D1 changes token lifecycle | Coordinate cookie/refresh changes with frontend `tryRefresh()` flow |
| **Email/async cutover** | Inline → queued email changes timing/observability | Keep a synchronous fallback path during transition |

---

## 14. Appendix A — Endpoint Map (mounted under `/api/v1/`)

**Auth (`apps.accounts.urls`):** `login/`, `logout/`, `refresh/`, `register/`, `me/`, `change-password/`, `profile/`, `password-reset/`, `password-reset/confirm/`.
**Directory (`accounts.directory_urls`):** `users/invite/` (POST), `users/` (list/retrieve/update via router).
**Core:** `bulk-save/` (POST).
**Email:** `email/send-invitation/`, `email/send-leave/`, `email/send-notification/`.
**Collection routers (full CRUD, `WorkspaceScopedModelViewSet`):** `workspaces`, `workspace_members`, `workspace_roles`, `invite_codes`, `email_invitations`, `join_requests`, `pending_workspace_access`, `projects`, `client_requirements`, `functional_requirements`, `epics`, `sprints`, `retrospectives`, `tasks`, `task_comments`, `kanban_columns`, `labels`, `attendance`, `holidays`, `leave_requests`, `leave_balances`, `notifications` (+ `mark_all_read`), `time_entries`, `active_timers`, `github_integrations`, `gitlab_integrations`, `discord_integrations`, `git_commits`, `activity_logs`, `saved_searches`.
**Files (custom):** `files/` (CRUD + multipart create), `files/{id}/preview|view|download/`.
**Docs:** `/admin/`, `/api/schema/`, `/api/docs/`.
**WebSocket:** `ws/collections/`.

## 15. Appendix B — Model Inventory (33 models)

`accounts`: User · `workspaces`: Workspace, WorkspaceMember, WorkspaceRole, InviteCode, EmailInvitation, JoinRequest, PendingWorkspaceAccess · `projects`: Project · `requirements`: ClientRequirement, FunctionalRequirement · `epics`: Epic · `sprints`: Sprint, Retrospective · `tasks`: Task, TaskComment, KanbanColumn, Label · `attendance`: Attendance, Holiday · `leave`: LeaveRequest, LeaveBalance · `time_tracking`: TimeEntry, ActiveTimer · `notifications`: Notification · `activity`: ActivityLog, SavedSearch · `integrations`: GitHubIntegration, GitLabIntegration, DiscordIntegration, GitCommit · `files`: UploadedFile.

---

*End of Current System Audit. This document is the authoritative baseline; the Migration Matrix and replacement architecture derive exclusively from the findings above.*
