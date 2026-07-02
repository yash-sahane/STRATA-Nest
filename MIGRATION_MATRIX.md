# Migration Matrix — Django → NestJS

> **Purpose:** A complete, traceable mapping of every component in the existing Django backend (see [CURRENT_SYSTEM_AUDIT.md](CURRENT_SYSTEM_AUDIT.md)) to its NestJS equivalent. **Nothing is left unmapped.** This matrix is the bridge between the audit and the replacement architecture; the architecture may not introduce a mapping that does not originate here.
>
> **Legend — Risk:** 🟢 mechanical · 🟡 needs care · 🔴 behavior-changing/security-sensitive.
> **Legend — `+` :** "gains behavior" — capability the Django side lacked (per audit §11–§12) that the NestJS target adds. Marked so we never confuse a *port* with a *new build*.

---

## 0. Mapping Rules (the canonical translations)

| Django concept | NestJS equivalent | Rule |
|---|---|---|
| App (`apps/<x>`) | Feature **Module** (`apps/api/src/modules/<x>`) | 1 app → 1 module (some merges, see §1) |
| `models.py` (Django ORM) | **Prisma model** in `packages/prisma/schema` | 1 model → 1 Prisma model; soft-FK → real relation where safe |
| `serializers.py` (DRF) | **DTOs** (`*.request.dto.ts` + `*.response.dto.ts`) + `class-transformer` mapper | Input DTO (class-validator) + Output DTO (camel contract) |
| `viewsets.py` ViewSet | **Controller** (HTTP) **+ Service** (logic + Prisma) | Default split; **Repository is opt-in** — only for complex joins/aggregates/reuse, not CRUD (review #4) |
| `views.py` APIView | **Controller** + **Service** | Bespoke endpoints become explicit handlers |
| `urls.py` router | Controller `@Controller()` + route decorators | Versioned `/api/v1` global prefix |
| `signals.py` receiver | **Domain event** (`EventEmitter2`) + handler | Replace implicit signals with explicit events |
| Celery task (none exist) | **BullMQ job** (`apps/worker`) | Greenfield; see §6 |
| Channels consumer | **WebSocket Gateway** (Socket.IO + Redis adapter) | Authorized rooms |
| Middleware / auth class | **Guard / Middleware / Interceptor** | See §7 |
| `core` convention layer | `packages/common` + global Nest providers | Base behaviors become Nest infrastructure |
| DRF pagination/exception/filter | **Interceptor / ExceptionFilter / query Pipe** | Preserve wire envelopes |

---

## 1. App → Module

| Django app | NestJS module(s) | Risk | Notes |
|---|---|---|---|
| `apps.core` | `packages/common` + `CoreModule` (global) + `PrismaModule` | 🟡 | Becomes infrastructure, not a feature module (§3). `bulk_save` → `GenerationModule` (business); model/prompt calls → `AiModule` (infra) — kept separate (review #14). |
| `apps.accounts` | `AuthModule` + `UsersModule` | 🟡 | Split authentication (login/refresh/…) from the user directory. Auth lives **in the module, not a `packages/auth`** (review #1). |
| `apps.workspaces` | `WorkspacesModule` (+ `MembershipModule`, `InvitationsModule` sub-areas) | 🔴 | Add real RBAC + invitation/join workflows (audit D3, §6.1). |
| `apps.realtime` | `RealtimeModule` (Gateway + Redis adapter) + cross-cutting `events` | 🔴 | Authorized rooms (audit D2). |
| `apps.projects` | `ProjectsModule` | 🟢 | |
| `apps.requirements` | `RequirementsModule` (ClientRequirement + FunctionalRequirement) | 🟢 | |
| `apps.epics` | `EpicsModule` | 🟢 | |
| `apps.sprints` | `SprintsModule` (Sprint + Retrospective) | 🟢 | |
| `apps.tasks` | `TasksModule` (Task, TaskComment, KanbanColumn, Label) | 🟡 | Add kanban move/reorder + blocker-edge logic server-side (D9). |
| `apps.attendance` | `AttendanceModule` (Attendance + Holiday) | 🟡 | + check-in/out + hours computation (D9). |
| `apps.leave` | `LeaveModule` (LeaveRequest + LeaveBalance) | 🟡 | + approval workflow + balance deduction (D9). |
| `apps.notifications` | `NotificationsModule` | 🟡 | + server-side notification engine reacting to events. |
| `apps.time_tracking` | `TimeTrackingModule` (TimeEntry + ActiveTimer) | 🟡 | + timer start/stop/pause + scope `ActiveTimer` (D5). |
| `apps.integrations` | `IntegrationsModule` (+ webhook controllers, Git queue) | 🔴 | + webhook receivers + API calls (absent today, §6.12). Encrypt tokens (D4). |
| `apps.activity` | `ActivityModule` (ActivityLog + SavedSearch) | 🟡 | + server-side audit via event subscribers (D9). |
| `apps.files` | `FilesModule` | 🟡 | Multer + storage abstraction + streaming. |
| `apps.emails` | `EmailModule` (producer) → email BullMQ queue (consumer) | 🟠 | Move from inline to queued (D7). |

---

## 2. Model → Prisma Model

> All extend the Django `TimestampedModel` → a shared Prisma shape: `id String @id @default(...)` (20-char app-generated, audit §9.1), `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`. **Soft FKs** (audit §9.2) become **real relations** unless the audit flags dangling-data risk, in which case the relation is **nullable** and enforced after a backfill.

| Django model | Prisma model | Soft-FK promotions (→ relation) | Risk |
|---|---|---|---|
| `User` | `User` | — | 🟡 (PermissionsMixin tables dropped; keep `role`,`isAdminFlag`,`hasTempPassword`) |
| `Workspace` | `Workspace` | — | 🟢 |
| `WorkspaceMember` | `WorkspaceMember` | `role` str → relation to `WorkspaceRole` (optional) + enum | 🟡 |
| `WorkspaceRole` | `WorkspaceRole` (+ `Permission`, `RolePermission`, `UserPermission`) | `permissions` JSON → **normalized tables** (review #13) | 🟡 (now actually enforced, §7) |
| `InviteCode` | `InviteCode` | — | 🟢 |
| `EmailInvitation` | `EmailInvitation` | — | 🟢 |
| `JoinRequest` | `JoinRequest` | — | 🟡 (consider merging w/ PendingWorkspaceAccess, D14) |
| `PendingWorkspaceAccess` | `PendingWorkspaceAccess` (or fold into JoinRequest) | — | 🟡 |
| `Project` | `Project` | `member_ids` JSON → keep JSON **and**/or `ProjectMember` join (decide in arch) | 🟡 |
| `ClientRequirement` | `ClientRequirement` | — | 🟢 |
| `FunctionalRequirement` | `FunctionalRequirement` | `epic_id`,`sprint_id`,`client_requirement_id` → relations (nullable); `tags`/`linked_project_ids` CSV → `String[]` | 🟡 (D6,D13) |
| `Epic` | `Epic` | `requirement_id` → relation (nullable) | 🟡 |
| `Sprint` | `Sprint` | — | 🟢 |
| `Retrospective` | `Retrospective` | — | 🟢 |
| `Task` | `Task` | soft FKs (`sprint_id`,`epic_id`,`functional_requirement_id`,`parent_task_id`) → relations (nullable); `labels` JSON → **`TaskLabel` join** over `Label` (review #7, wire shape preserved); `blocked_by`/`blocks` → `TaskDependency` edge table | 🔴 (D6; relations + join + dependency tables) |
| `TaskComment` | `TaskComment` | — | 🟢 |
| `KanbanColumn` | `KanbanColumn` | — | 🟢 |
| `Label` | `Label` | — | 🟢 |
| `Attendance` | `Attendance` | — | 🟢 (unique `(workspace,user,date)` preserved) |
| `Holiday` | `Holiday` | — | 🟢 |
| `LeaveRequest` | `LeaveRequest` | `approved_by` str → relation (nullable) | 🟡 |
| `LeaveBalance` | `LeaveBalance` | — | 🟢 |
| `TimeEntry` | `TimeEntry` | `task_id`,`project_id` → relations (nullable); keep denorm snapshots as plain cols | 🟡 |
| `ActiveTimer` | `ActiveTimer` | **add `workspaceId`** (D5); `task_id`/`project_id` → relations | 🟡 |
| `Notification` | `Notification` (+ `NotificationDelivery`) | `project_id` → relation (nullable); per-channel delivery split into `NotificationDelivery` (review #9) | 🟡 |
| `ActivityLog` | `ActivityLog` | polymorphic `entity_type`+`entity_id` kept as scalar pair; **append-only** (INSERT-only, review #8) | 🟢 |
| `SavedSearch` | `SavedSearch` | — | 🟢 |
| `GitHubIntegration` | `GitHubIntegration` | **add `workspaceId`** (D5); `access_token` → **encrypted** column (D4) | 🔴 |
| `GitLabIntegration` | `GitLabIntegration` | **add `workspaceId`**; encrypt token | 🔴 |
| `DiscordIntegration` | `DiscordIntegration` | **add `workspaceId`** | 🟡 |
| `GitCommit` | `GitCommit` | **add `workspaceId`** (via project) | 🟡 |
| `UploadedFile` | `UploadedFile` | `workspace_id`/`project_id` → relations (nullable, `""`→null) | 🟡 |

**Enums:** every Django `choices` tuple (USER_ROLES, *_STATUS, *_PRIORITY, LEAVE_TYPE×10, TASK_STATUS, etc.) → a Prisma `enum`. Risk 🟢 except `LeaveType` (10 values, post-migration 0002) and free-text `WorkspaceMember.role` (🟡 — needs reconciliation against the role enum/custom roles).

---

## 3. `apps.core` Convention Layer → NestJS Infrastructure

| Django primitive (audit §4) | NestJS equivalent | Risk |
|---|---|---|
| `TimestampedModel` (string PK, timestamps, ordering) | Shared Prisma fields + `@default` id generator util in `packages/common` | 🟡 |
| `generate_native_id()` (20-char) | `generateId()` util (same alphabet/length) — **byte-for-byte compatible** | 🔴 (must match) |
| `NativeModelSerializer` (snake↔camel, id→string) | `class-transformer` `@Expose({name})` on Response DTOs + a global `ClassSerializerInterceptor` | 🟡 |
| `CamelCaseQueryFilter` (generic filter/order) | `QueryParsePipe` + per-resource **allowlisted** filter spec (close D11) | 🔴 (preserve operators: `ne,lt,lte,gt,gte,icontains→contains,isnull,not_in,in`) |
| `NativePagination` (`{items,total,page,pageSize}`) | `PaginationInterceptor` / paginated response DTO | 🟡 (envelope frozen) |
| `api_exception_handler` (`{error:{message,code,type}}`) | Global `AllExceptionsFilter` | 🟡 (envelope frozen) |
| `WorkspaceScopedModelViewSet.get_queryset` (membership scoping) | `WorkspaceGuard` + `@WorkspaceScoped()` + a **shared scope helper** applied in the service's Prisma calls (not a per-module repository, review #4) | 🔴 (auth-critical; preserve superuser/`is_admin_flag` + `workspace=""` semantics deliberately) |
| `core/permissions.py` (`IsWorkspaceMember`,`IsOwnerOrReadOnly` — unused) | `WorkspaceGuard`, `OwnerGuard`, `PermissionsGuard` (now actually wired) | 🟡 |
| `JWTCookieMiddleware` (cookie→header) | Not needed — `JwtStrategy` cookie extractor reads the cookie directly | 🟢 |
| `bulk_views.BulkSaveView` (CR→Epic→FR→Task tree) | `GenerationService.bulkSave()` in a Prisma `$transaction` + `HierarchyIdService` | 🔴 (port hierarchy-id + classification logic exactly) |

---

## 4. Serializer → DTO

**Rule:** each DRF serializer splits into (a) a **Request DTO** with `class-validator` decorators (replacing serializer `validate_*`/field constraints) and (b) a **Response DTO** carrying the camelCase contract via `class-transformer`. `read_only`/`write_only` map to omitting the field from the other DTO.

| Representative serializers | NestJS DTOs | Risk |
|---|---|---|
| `UserSerializer` (+ `workspaceIds`, `isAdmin`, `userEmail` derived) | `UserResponseDto` (+ computed via service), `UpdateProfileDto` | 🟡 |
| `LoginSerializer`,`RegisterSerializer`,`ChangePasswordSerializer`,`PasswordReset*`,`InviteUserSerializer` | `LoginDto`,`RegisterDto`,`ChangePasswordDto`,`PasswordResetDto`,`PasswordResetConfirmDto`,`InviteUserDto` | 🟡 (port `validate_password`, email-lowercasing, uniqueness check) |
| All `NativeModelSerializer` subclasses (~25: Workspace, Project, Task, FR, Sprint, Leave, Attendance, TimeEntry, …) | `Create<X>Dto` + `Update<X>Dto` (PartialType) + `<X>ResponseDto` | 🟢/🟡 |
| `accessToken write_only` (integrations) | omit from Response DTO; encrypt in service (D4) | 🔴 |
| `SerializerMethodField` (`memberIds`,`workspaceIds`,`url`) | resolved in service/repository (avoid N+1, audit §11.2) | 🟡 |
| JSON passthrough fields (`assignedTo`,`labels`,`customFields`,…) | typed DTO props (`string[]`, nested DTOs) | 🟡 |

---

## 5. ViewSet/APIView → Controller + Service (+ Repository)

| Django endpoint group | Controller | Service responsibilities | Risk |
|---|---|---|---|
| `LoginView/Logout/Refresh/Me/Register/ChangePassword/UpdateProfile/PasswordReset*` | `AuthController` | `AuthService` (issue/rotate/**blacklist** tokens — fix D1), cookie setting via `res` | 🔴 |
| `InviteUserView` | `InvitationsController` | `InvitationsService` (+ role gate, D3) | 🔴 |
| `UserViewSet` | `UsersController` | `UsersService` (peer directory, self-update guard) | 🟡 |
| `BulkSaveView` | `GenerationController` | `GenerationService` ($transaction) | 🔴 |
| Email APIViews | `EmailController` | enqueue to email queue (D7) | 🟠 |
| `NotificationViewSet` (+`mark_all_read`) | `NotificationsController` (`POST mark-all-read`) | `NotificationsService` | 🟢 |
| `UploadedFileViewSet` (+preview/view/download) | `FilesController` | `FilesService` + `StorageService` (stream) | 🟡 |
| All `WorkspaceScopedModelViewSet` CRUD (~30 collections) | one `*Controller` each | `*Service` calling **Prisma directly** (repository only if complex, review #4); `WorkspaceGuard` applies scoping | 🟡 (preserve generic filter/sort/pagination behavior) |

**ViewSet → split (the rule applied everywhere — revised per review #4):**
- ViewSet *routing/(de)serialization* → **Controller** (`@Get/@Post/@Patch/@Delete`, DTOs, guards).
- ViewSet *`perform_create`/business* **and** *`get_queryset`/ORM* → **Service**, calling **Prisma directly** with the shared workspace-scope helper.
- **Repository = opt-in:** added only when a module accumulates complex joins, aggregates, or reusable specifications — never as a pass-through wrapper over `prisma.x.create()`. Removes an estimated ~25–35% of CRUD boilerplate.

---

## 6. Signals & Celery → Events & BullMQ Jobs

### 6.1 Django signals → Domain events
| Django (audit §7) | NestJS | Risk |
|---|---|---|
| Global `post_save`/`post_delete` → realtime broadcast | **Explicit, business-meaningful domain events** (`TaskAssigned`, `TaskMoved`, `LeaveApproved`, … — no generic `*Updated`, review #5) defined in `packages/shared/events` (review #2), emitted by services **after commit** via `EventEmitter2`; a `RealtimeSubscriber` → **authorized** Gateway rooms; an `AuditSubscriber` writes append-only `ActivityLog`; a `NotificationSubscriber` creates notifications | 🔴 (replaces implicit magic with explicit events; fixes D2/D10 — commit-gated, scoped, full payload) |
| `REALTIME_COLLECTION` attribute | Event name registry / `@RealtimeResource()` metadata | 🟡 |

### 6.2 Celery → BullMQ (greenfield — audit §8: **no tasks exist today**)
| Queue (per brief) | Producers | Jobs | Source today |
|---|---|---|---|
| **Email** | Auth/Invitations/Notifications services | send invitation/welcome/reset/notification | inline `emails.service` (D7) |
| **Notification** | event subscribers | fan-out create + WS push | client-created today |
| **Reminder / Deadline** | scheduler (BullMQ repeatable) | task due / sprint end reminders | **absent** |
| **Attendance** | scheduler | daily roll-up / absent-marking | **absent** |
| **AI** | AiModule | long-running generation (if moved server-side) | frontend-only today |
| **Git** | Integrations webhooks | fetch commits / auto-update status | **absent** (§6.12) |
| **Webhook** | inbound webhook controllers | verify + dispatch provider payloads (review #6) | **absent** |
| **Export** | reports/analytics | CSV/PDF generation → upload → notify (review #6) | **absent** |
| **Import** | bulk import endpoints | parse + validate + upsert + report (review #6) | **absent** |

> Every BullMQ queue is a **net-new build**, not a port. The matrix records this so the architecture doesn't claim a 1:1 Celery migration.

---

## 7. Middleware / Auth / Channels → Guards, Interceptors, Gateway

| Django (audit §5,§7) | NestJS | Risk |
|---|---|---|
| `JWTCookieMiddleware` | cookie extractor in `JwtStrategy` (Passport) | 🟢 |
| `JWTCookieAuthentication` (DRF) | `JwtAuthGuard` (global) + `@Public()` decorator | 🟡 |
| `IsAuthenticated` default permission | global `JwtAuthGuard` | 🟢 |
| Workspace membership scoping (base viewset) | `WorkspaceGuard` + scope helper | 🔴 |
| `is_superuser`/`is_admin_flag` bypass | `@Roles()` / `PlatformAdminGuard` | 🟡 (reproduce exactly) |
| (missing) RBAC | `PermissionsGuard` + `@RequirePermission()` consulting `WorkspaceRole.permissions`/role | 🔴 (+new, D3) |
| DRF exception handler | `AllExceptionsFilter` | 🟡 |
| DRF pagination | `PaginationInterceptor` | 🟡 |
| `CamelCaseQueryFilter` | `QueryParsePipe` (allowlisted) | 🔴 |
| CORS / CSRF (`corsheaders`, `CsrfViewMiddleware`) | `app.enableCors({credentials})` + CSRF strategy for cookie auth | 🟡 |
| `SecurityMiddleware`/HSTS (prod.py) | Helmet + reverse-proxy config | 🟢 |
| Channels `JWTCookieAuthMiddleware` | Socket.IO middleware reading `lt_access` cookie | 🟡 |
| `CollectionConsumer` (subscribe/unsubscribe) | `RealtimeGateway` `@SubscribeMessage('subscribe')` **with room authorization** | 🔴 (fix D2) |
| Channels Redis layer | `@socket.io/redis-adapter` | 🟢 |
| `_safe_serialize` WS payload | event payload from the same Response DTOs (consistent shape, fix D10) | 🟡 |

---

## 8. Cross-cutting & Config

| Django | NestJS | Risk |
|---|---|---|
| `config/settings/*` (`django-environ`) | `@nestjs/config` + Zod-validated `packages/config` | 🟢 |
| `drf-spectacular` (`/api/schema`,`/api/docs`) | `@nestjs/swagger` | 🟢 |
| `django-storages[s3]` + local `MEDIA_ROOT` | `StorageService` (S3 SDK / local driver) | 🟡 |
| SimpleJWT settings | `@nestjs/jwt` + refresh-token store (Redis/DB) for revocation (fix D1) | 🔴 |
| Resend via `requests` | email queue worker calling Resend SDK/HTTP | 🟠 |
| `manage.py`/migrations | `prisma migrate` | 🟡 (data migration of string PKs/soft FKs, audit §13) |
| Admin (`/admin/`, `accounts/admin.py`) | **No direct equivalent** — replace with admin API endpoints or keep out of scope | 🟡 (flag: Django admin is a feature being dropped) |
| Test suite | **None exists** (D16) → Jest unit + e2e + contract tests | 🟠 (build characterization tests first) |

---

## 9. Migration Order Matrix (review: "migration order matters enormously")

Modules are converted in **dependency order — never randomly**. Each phase ships behind nginx routing + feature flags and must pass parity tests (arch §19) before the next begins (arch §20). This is the authoritative sequence; developers do not pick modules ad hoc.

| Phase | Modules (Django app → NestJS) | Depends on | Why this order |
|---|---|---|---|
| **0** | `packages/common`, Prisma introspect, contract+characterization harness | — | Foundations: id-gen byte-parity, envelopes, query pipe, frozen-contract tests |
| **1** | `accounts` → `AuthModule` + `UsersModule` | 0 | Everything needs identity + tokens; ships D1 refresh-revocation fix |
| **2** | `workspaces` → `WorkspacesModule` (membership, **RBAC**, invitations, join requests) | 1 | Every domain resource is workspace-scoped + permission-gated (§7) |
| **3** | `projects` → `ProjectsModule` | 2 | Root of the PM hierarchy |
| **4** | `requirements` → `RequirementsModule` (CR + FR) | 3 | Hang off projects |
| **5** | `epics` → `EpicsModule`; `sprints` → `SprintsModule` (+ Retrospective) | 3 | Planning entities referenced by tasks |
| **6** | `tasks` → `TasksModule` (Task, Comment, Kanban, Label, **TaskLabel**, **TaskDependency**) | 3–5 | Largest domain; references epics/sprints/FRs as relations |
| **7** | `realtime` gateway + event bus (`packages/shared/events`) | 1–6 | Needs scoped resources to authorize rooms (fixes D2) |
| **8** | `attendance`, `leave`, `time_tracking` | 2 | Independent HR domains; add **server-side computation/approval** [NEW, D9] |
| **9** | `notifications`, `activity` (event-driven engines) | 7 | React to domain events; append-only audit [NEW, D9] |
| **10** | `files` (StorageService); `emails` → email queue | 2 | Storage abstraction + queued mail (D7) |
| **11** | `integrations` (+ webhook controllers, git queue, token encryption) | 3,7 | Webhook receivers + side effects [NEW, D4/§6.12] |
| **12** | `generation` (bulk-save) + `ai`; **decommission Django** | all | Final cutover; exact hierarchy-id/classification port (A§4.9) |

> Phases 3–6 are strictly linear (hierarchy dependencies). Phases 8/10 can run in parallel with 9/11 once 7 lands. Phase 12 is the kill switch.

## 10. Unmapped-Check (completeness assertion)

Every item below from the audit is accounted for above:
- ✅ 17 apps → §1 · ✅ 33 models + enums → §2 · ✅ core layer (9 primitives) → §3 · ✅ ~30 serializers → §4 · ✅ all viewsets/APIViews/custom actions (`mark_all_read`, file streaming, bulk-save, invite, email) → §5 · ✅ global signals + `REALTIME_COLLECTION` → §6.1 · ✅ Celery (0 tasks) + 7 queues → §6.2 · ✅ all middleware/auth/Channels → §7 · ✅ settings, storage, JWT, email, admin, docs, tests → §8.
- **Capabilities the audit found absent/frontend-only** (RBAC enforcement, invitation/join workflows, leave/attendance/time computation, notification & audit engines, integration webhooks, async jobs, token revocation, scoped realtime) are explicitly tagged `+`/🔴 as **new builds**, not ports — so the architecture phase treats them as additive scope, with parity tests guarding the ported parts.

---

*End of Migration Matrix. Proceed to the replacement architecture, which must reference only the mappings above.*
