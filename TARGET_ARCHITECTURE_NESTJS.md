# L‑T‑Connect — Target Backend Architecture (NestJS)

> **This is the replacement architecture document.** It supersedes the Django backend design.
> **Traceability rule:** every decision here cites the audit ([CURRENT_SYSTEM_AUDIT.md](CURRENT_SYSTEM_AUDIT.md), `A§n`) and/or the matrix ([MIGRATION_MATRIX.md](MIGRATION_MATRIX.md), `M§n`). No capability appears here that is not grounded there. Capabilities the audit found **absent or frontend-only** are marked **[NEW]** and are deliberate additive scope, not silent invention.
> **Contract rule:** the camelCase REST contract, the `{items,total,page,pageSize}` and `{error:{message,code,type}}` envelopes, the `lt_access`/`lt_refresh` cookies, the collection slugs, and the WS frame `{event,payload,channels,timestamp}` are **frozen** (A§13). The frontend does not change shape; it gains correctness.

> **Revision r2 (post architecture review):** incorporated reviewer feedback — (1) dropped `packages/auth` (auth lives in its module); (2) event contracts moved under `packages/shared/events`; (3) `packages/shared` split into typed sub-areas, not a dumping ground; (4) **Repository layer is opt-in** — default is `Controller → Service → Prisma`, repositories only for complex joins/aggregates/reuse; (5) events carry **business meaning** (no generic `*Updated`); (6) added Export/Import/Webhook queues; (7) `Task.labels`→`TaskLabel` join, permissions normalized (`Permission`/`RolePermission`/`UserPermission`); (8) `ActivityLog` append-only; (9) `Notification`→`NotificationDelivery` split; (10) `Idempotency-Key` support; (11) hard rule: **no jobs/WS/email inside a transaction — commit then emit**; (12) Redis partitioned by logical DB; (13) `GenerationModule` (business) separated from `AiModule` (infrastructure); (14) all blob access via `StorageService` only.

> **Revision r3 (pre-scaffold):** added (a) **§3.1 Application / Domain Services** for cross-module orchestration (invitation acceptance, sprint completion, leave approval); (b) **§17.1 CQRS scoped to read-heavy dashboards**, not global; (c) **Appendix A — ADRs** under `docs/adr/` recording the 12 major decisions.

---

## Table of Contents
1. High-level architecture · 2. Folder structure · 3. Module dependency graph · 4. Database architecture · 5. Prisma schema organization · 6. Authentication flow · 7. Authorization design · 8. REST API design · 9. WebSocket architecture · 10. Queue architecture · 11. Event-driven architecture · 12. Background jobs · 13. Infrastructure · 14. Deployment · 15. Security · 16. Scalability · 17. Performance · 18. Caching · 19. Testing · 20. Migration plan · 21. Risks & trade-offs · 22. Future microservice extraction

---

## 1. High-Level Architecture

A **two-process modular monolith** in a TypeScript monorepo: an **API** process (HTTP + WebSocket) and a **Worker** process (BullMQ consumers), sharing Prisma, Redis, and domain packages.

```
                     ┌──────────────── Next.js (App Router, TanStack Query) ─────────────┐
                     │  REST (cookie JWT)            WebSocket (Socket.IO)               │
                     └───────────────┬───────────────────────────┬───────────────────────┘
                                     │                           │
                          ┌──────────▼───────────┐    ┌──────────▼───────────┐
                          │  apps/api (NestJS)    │    │  Socket.IO Gateway   │
                          │  Controllers/Services │    │  (Redis adapter)     │
                          │  Guards/Interceptors  │    └──────────┬───────────┘
                          │  EventEmitter2 ───────┼──── domain events                  
                          └─────┬─────────┬───────┘               │
                     Prisma ◄───┘         └──► BullMQ producers ──┤
                          │                                       │ Redis (pub/sub + streams)
                  ┌───────▼────────┐                     ┌────────▼─────────┐
                  │  PostgreSQL    │                     │ apps/worker      │
                  │                │                     │ Email/Notif/AI/  │
                  └────────────────┘                     │ Git/Reminder Qs  │
                                                         └──────────────────┘
```

**Why this shape (not microservices):** the audit shows a tightly-cohesive product with one membership-scoped data domain and **no existing service boundaries** (A§11.1 — apps cross-import a shared membership concept). A modular monolith keeps the camelCase contract intact, lets us add the missing server-side behavior fast, and preserves clean seams for later extraction (§22). The **API/Worker split is the one hard boundary** the brief mandates and the only one the workload justifies today (A§8).

**Core principle changes vs. Django (the point of the re-platform):**
| Today (A§) | Target |
|---|---|
| Thin CRUD; rules in frontend (A§10) | Services own invariants & transactions |
| Membership-only authz (A§5.5) | Policy-based RBAC enforced server-side (§7) |
| Global signal firehose (A§7) | Explicit domain events → authorized rooms (§9,§11) |
| Celery unused; email inline (A§8) | BullMQ worker; queued email (§10,§12) |
| Soft FKs, no integrity (A§9.2) | Prisma relations + cascades (§4,§5) |

---

## 2. Folder Structure

```
lt-connect/
├─ apps/
│  ├─ api/                         # NestJS HTTP + WS (M§1)
│  │  └─ src/
│  │     ├─ main.ts                # bootstrap: global prefix /api/v1, cookie parser, helmet, cors{credentials}
│  │     ├─ app.module.ts
│  │     └─ modules/
│  │        ├─ auth/               # M§1 — owns JWT, Passport, strategies, guards (no separate package)
│  │        ├─ users/              # M§1 (from accounts directory)
│  │        ├─ workspaces/         # incl. membership, roles, invitations, join-requests
│  │        ├─ projects/ requirements/ epics/ sprints/ tasks/
│  │        ├─ attendance/ leave/ time-tracking/
│  │        ├─ notifications/ activity/ files/ integrations/
│  │        ├─ generation/         # bulk-save BUSINESS logic (A§4.9)
│  │        ├─ ai/                 # AI INFRASTRUCTURE (model calls/prompts) — separate from generation (review #14)
│  │        ├─ storage/            # StorageService (S3/MinIO/local drivers) — sole blob entry point (review #15)
│  │        └─ realtime/           # Socket.IO gateway (A§7)
│  ├─ worker/                      # BullMQ consumers (M§6.2)
│  │  └─ src/processors/{email,notification,reminder,attendance,ai,git,deadline,export,import,webhook}.processor.ts
│  └─ (frontend stays in /frontend, unchanged contract)
├─ packages/
│  ├─ prisma/        # schema (split per §5), client, migrations, seed
│  ├─ common/        # core layer (A§4): id-gen, pagination, exception filter, query pipe, response DTO base
│  ├─ shared/        # SPLIT — not a dumping ground (review #3):
│  │  ├─ types/  interfaces/  enums/  constants/
│  │  ├─ contracts/ # API request/response contract types (shared w/ frontend)
│  │  ├─ events/    # domain event names + payload contracts (consumed by api AND worker — review #2)
│  │  └─ utils/     # grouped modules (date/, id/, text/) — never one 300-fn utils.ts
│  └─ config/       # Zod-validated env (M§8)
├─ infra/
│  ├─ docker/        # Dockerfiles (api, worker), docker-compose
│  ├─ nginx/         # reverse proxy / WS upgrade
│  └─ terraform/     # optional IaC
└─ package.json (pnpm workspaces / turborepo)
```
> **Why no `packages/auth` (review #1):** authentication is consumed by exactly one app (`apps/api`); the worker uses internal job auth, not user JWT. A package would be premature abstraction. Auth lives in `apps/api/src/modules/auth`. Promote to a package only if a second app ever consumes it.

**Per-module layout** (default = `Controller → Service → Prisma`; review #4 / "biggest recommendation"):
```
modules/tasks/
  tasks.controller.ts      # routing, DTO binding, guards (← ViewSet routing)
  tasks.service.ts         # business logic, transactions, events, AND Prisma calls (← perform_create + get_queryset)
  dto/ create-task.dto.ts update-task.dto.ts task.response.dto.ts
  tasks.module.ts
  tasks.service.spec.ts
  # tasks.repository.ts  ← OPT-IN ONLY: add when queries get complex (joins, aggregates, reusable
  #                        specifications). Never a pass-through wrapper over prisma.task.create().
```
> **Repository policy (review #4):** NestJS + Prisma already abstract the ORM, so a mandatory repository per CRUD module just doubles boilerplate (`TaskRepository.create()` → `prisma.task.create()`). Default to the service calling Prisma directly; extract a repository only where real query complexity or reuse appears. Estimated ~25–35% less boilerplate. The workspace-scoping helper (§7) is a shared function, not a per-module repository.

---

## 3. Module Dependency Graph

```
       ┌──── common / config / shared (types·interfaces·enums·contracts·events·utils) — no domain deps ────┐
            │                                                                              │
        PrismaModule ── AuthModule ── UsersModule                                          │
            │               │                                                              │
     WorkspacesModule ◄─────┴── (every domain module depends on Workspaces for scope/RBAC) │
            ▲                                                                              │
   ┌────────┼──────────────────────────────────────────────────────────────────┐         │
 Projects  Requirements  Epics  Sprints  Tasks  Attendance  Leave  TimeTracking  │         │
   │         │            │      │        │                                       │         │
   └─────────┴────────────┴──────┴────────┴──► EventEmitter2 ──► RealtimeModule ──┘         │
                                              │                Notifications/Activity ◄─────┘
                                              └──► BullMQ producers ──► (worker consumes)
```

**Rules (enforced by lint/`nestjs-spelunker` boundaries):**
- `common`, `shared` (incl. `shared/events`), `config` depend on nothing domain-specific.
- Every domain module depends on `WorkspacesModule` (scope + RBAC) and `PrismaModule` only — **not on each other** (replaces the audit's lazy cross-imports, A§11.1).
- Services call **Prisma directly** by default (review #4); a repository appears only on demonstrated query complexity.
- Cross-domain reactions go through **events**, never direct service calls (e.g., `task.assigned` → NotificationsModule subscriber). This removes the implicit signal coupling of A§7.

### 3.1 Application / Domain Services (cross-module orchestration)

Most endpoints are single-module (`Controller → Service → Prisma`). A minority of workflows **span modules** and own an invariant that no single domain module should own. These live in thin **Application Services** (use-case / orchestration services) under `apps/api/src/application/`. They compose domain services inside one transaction and emit a single post-commit event (§4 rule). They hold **orchestration, not domain rules** — the rules stay in each owning domain service.

**Direction rule:** application services depend on domain services; **domain modules never import application services** (preserves the no-module→module-import rule, §3). This is where the audit's lazy cross-app imports (A§11.1) are resolved *explicitly* instead of implicitly.

| Application service | Coordinates | Responsibility (all **[NEW]** server-side, A§10) |
|---|---|---|
| `InvitationAcceptanceService` | workspaces · invitations · membership | validate token/code → create `WorkspaceMember` → mark invitation accepted → emit `InvitationAccepted` |
| `SprintCompletionService` | sprints · tasks | close sprint → roll/flag incomplete tasks → seed retrospective → emit `SprintCompleted` |
| `LeaveApprovalService` | leave (request + balance) · authz | authorize approver (manager) → set status → **deduct `LeaveBalance`** → emit `LeaveApproved` |
| `BulkGenerationService` | requirements · epics · tasks | the existing `bulk-save` tree build (A§4.9), formalized as orchestration |

**Heuristic:** ≥2 domain services in one transaction ⇒ Application Service; a single aggregate ⇒ keep it in that module's service. This gives cross-cutting workflows a clear home while keeping domain modules decoupled.

---

## 4. Database Architecture

**Engine:** PostgreSQL (unchanged from A§3). **ORM:** Prisma (M§2).

**Identity (A§9.1 — critical):** keep the **20-char app-generated string PK** for every model. `generateId()` in `packages/common` must reproduce the Django alphabet/length **byte-for-byte** (M§3) so existing IDs, soft-FK strings, and frontend cache keys remain valid.

```prisma
// shared shape applied to every model (Django TimestampedModel, A§4.1)
id        String   @id @default(dbgenerated())   // app sets 20-char id pre-insert
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

**Relationships & integrity (close A§9.2 / D6):**
- **Structural FKs** (already real in Django): `workspace`, `project`, `owner`, `createdBy`, comment→task, retrospective→sprint, integration→project → Prisma relations with explicit `onDelete`.
- **Soft FKs promoted to relations (nullable + backfilled):** `Task.{sprintId,epicId,functionalRequirementId,parentTaskId}`, `FunctionalRequirement.{epicId,sprintId,clientRequirementId}`, `Epic.requirementId`, `TimeEntry.{taskId,projectId}`, `Notification.projectId`, `UploadedFile.{workspaceId,projectId}`. They stay **nullable** because production data may contain `""`/dangling values (A§13) — enforce only after a data-quality pass.
- **New join/edge tables** replace JSON arrays wherever querying matters (review #7):
  - `TaskDependency(taskId, dependsOnId, type)` replaces `Task.blocked_by`/`blocks` JSON (A§6.6) with integrity + cycle checks.
  - `TaskLabel(taskId, labelId)` normalizes `Task.labels` JSON against the `Label` catalog (A§6.6) for indexable label filtering. **Wire contract unchanged** — the Task Response DTO still emits `labels: [...]`, composed from the join (A§13).
  - Authorization normalizes to `Permission` / `RolePermission` / `UserPermission` (§7), replacing `WorkspaceRole.permissions` JSON (A§6.1) long-term.

**Cascading rules (representative):**
| Parent delete | Effect |
|---|---|
| Workspace | `Cascade` to memberships, projects, and all workspace-scoped rows (mirrors Django CASCADE) |
| Project | `Cascade` to requirements/epics/sprints/tasks/labels/columns/integrations |
| User (owner) | `Restrict` (Django `PROTECT` on owner/createdBy) — preserve A§6 semantics |
| Task | `Cascade` to comments; `SetNull` for dependent soft links |

**Transaction strategy & the side-effect rule (review #11):** Services own transactions (Prisma `$transaction`) for any multi-row invariant — `generation.bulkSave` (A§4.9), leave approval + balance deduction **[NEW]**, invitation acceptance **[NEW]**, kanban reorder, label/dependency edits. **Hard rule: never enqueue a BullMQ job, emit a WebSocket frame, or send email inside a transaction.** The order is always:

```
$transaction { … }  →  commit  →  emit domain event  →  subscriber (enqueue job / push WS / send email)
```

This guarantees no phantom side effects on rollback (fixes the pre-commit broadcast bug, A§7.2/D10) and keeps write latency off Redis/SMTP.

**Soft deletes:** introduce `deletedAt` only where the product needs recoverability (Tasks, Projects, Workspaces). Everywhere else, hard delete (matches today's behavior, A§6). Avoid global soft-delete to keep queries honest.

**Audit fields:** keep the denormalized `*_name` snapshots (A§9.3) for contract parity, but treat the relation as source of truth and refresh snapshots on write via the owning service.

**Append-only audit log (review #8):** `ActivityLog` is **INSERT-only — never UPDATE/DELETE** (enforced by a restricted DB role/grant), making the trail tamper-evident. It is written server-side by `AuditSubscriber` (§11), replacing today's client-written logs (A§6.11/D9).

**Notification delivery split (review #9):** a `Notification` (the in-app record) is separated from `NotificationDelivery` rows (one per channel — in-app/email/push), so a notification can fan out to multiple transports with independent status/retry without overloading one table. Future-proofs push/digest delivery (today it is a single table, A§6.10).

---

## 5. Prisma Schema Organization

Single logical schema, **split by domain file** (Prisma `prismaSchemaFolder`) mirroring modules (M§2):
```
packages/prisma/schema/
  base.prisma          # generator, datasource, shared enums
  identity.prisma      # User
  workspace.prisma     # Workspace, WorkspaceMember, WorkspaceRole, InviteCode, EmailInvitation, JoinRequest
  authz.prisma         # Permission, RolePermission, UserPermission  (normalized RBAC, review #13)
  project.prisma       # Project
  requirement.prisma   # ClientRequirement, FunctionalRequirement
  planning.prisma      # Epic, Sprint, Retrospective
  task.prisma          # Task, TaskComment, KanbanColumn, Label, TaskLabel, TaskDependency
  hr.prisma            # Attendance, Holiday, LeaveRequest, LeaveBalance
  time.prisma          # TimeEntry, ActiveTimer
  collab.prisma        # Notification, NotificationDelivery, ActivityLog, SavedSearch
  integration.prisma   # GitHub/GitLab/Discord Integration, GitCommit
  file.prisma          # UploadedFile
```
**Enums** (M§2): all Django `choices` → Prisma enums (`UserRole`, `ProjectStatus`, `TaskStatus`, `TaskPriority`, `LeaveType`(10), `LeaveStatus`, `AttendanceStatus`, `TimeEntryStatus`, `TimeEntryType`, …). `WorkspaceMember.role` reconciled to enum + optional custom-role relation (A§5.5/D3).
**Indexes** (preserve A§9.4 + add): all existing composite indexes; add indexes on every promoted relation FK and on `(workspaceId, deletedAt)` where soft delete is used.

---

## 6. Authentication Flow

**Preserve** (A§5.2): cookie-based JWT, `lt_access` (15 min) / `lt_refresh` (7 d), httpOnly, SameSite, Secure-in-prod. Passport (`@nestjs/passport`) with a custom cookie extractor (M§7 — replaces `JWTCookieMiddleware`).

**Fix D1 (revocable refresh):** refresh tokens become **server-tracked**. Each refresh token carries a `jti`; a `RefreshTokenStore` (Redis, TTL = refresh lifetime) holds valid `jti`s per user. Rotation **revokes the old `jti`** (the Django endpoint never did, A§5.3). Logout deletes the `jti`. This finally makes the rotation/blacklist intent real.

```
POST /api/v1/auth/login
  → validate (argon2/bcrypt) → issue access+refresh (jti) → store jti in Redis
  → Set-Cookie lt_access, lt_refresh → { user, sessionId: jti }   (shape frozen, A§5.3)

REST request → JwtAuthGuard reads lt_access cookie → req.user
  401 → frontend tryRefresh() (unchanged, A§13) → POST /auth/refresh

POST /api/v1/auth/refresh
  → verify lt_refresh + jti in store → ROTATE: new jti, revoke old → reset cookies
POST /api/v1/auth/logout → revoke jti → clear cookies
```
**Endpoints** (1:1 with A§5.3, M§5): `login, logout, refresh, register, me, change-password, profile, password-reset, password-reset/confirm`. `register` keeps `validate_password` rules; password reset keeps the signed-token flow (port Django token semantics or switch to a stored single-use token — decide in §20, coordinate with frontend reset URL).

**WebSocket auth** (A§7): Socket.IO middleware reads the same `lt_access` cookie; anonymous → disconnect (mirrors `close 4401`).

---

## 7. Authorization Design **[mostly NEW — A§5.5/D3]**

Three composable layers, all server-enforced (today only layer 1 + membership exist):

1. **Authentication** — global `JwtAuthGuard` (`@Public()` opt-out for login/register/refresh/reset).
2. **Workspace scope** — `WorkspaceGuard` resolves the target workspace (route param, body, or the resource's `workspaceId`) and asserts the caller has an **ACTIVE** `WorkspaceMember` (preserves A§4.6 base-viewset behavior, incl. `is_superuser`/`isAdminFlag` bypass — reproduce, don't drop). Repositories receive a scope filter so list endpoints are auto-restricted exactly as today.
3. **Policy/permission** — `PermissionsGuard` + `@RequirePermission('task:update')`. Permissions resolve through **normalized tables** (review #13): `Permission` (catalog), `RolePermission` (role→permission), `UserPermission` (per-user grants/overrides), seeded with a default role→permission map for the 7 built-in roles (A§5.1) and extensible via custom `WorkspaceRole`s (A§6.1). During migration we read the legacy `WorkspaceRole.permissions` JSON, then cut over to the tables. Ownership policies (`OwnerGuard`) cover self-update (A§5.4) and "creator can edit".

**Why policy-based, not hardcoded `if role==`:** the audit found ad-hoc checks scattered across invite/bulk-save/self-update (A§5.5). A central `CASL`-style ability (or a small policy registry) replaces them, supports custom roles (A§6.1), and makes "any member can approve their own leave" (D3, D9) impossible by giving `leave:approve` only to manager roles.

**Inherited permissions:** workspace role grants baseline; project-level membership (`Project.member_ids`/future `ProjectMember`) can narrow/extend per project. Platform admin (`isAdminFlag`/superuser) bypasses (parity with A§4.6).

---

## 8. REST API Design

**Frozen contract (A§13):** global prefix `/api/v1`; camelCase fields; collection slugs unchanged (M§3); pagination envelope `{items,total,page,pageSize}`; error envelope `{error:{message,code,type}}`; trailing-slash behavior matched to current routes.

- **DTOs everywhere** (M§4): `class-validator` Request DTOs (port serializer validation), `class-transformer` Response DTOs (camel mapping via `@Expose`). Global `ValidationPipe({whitelist, transform})`.
- **Standardized responses:** a `PaginationInterceptor` and a base `ResponseDto` reproduce the Django envelopes; `AllExceptionsFilter` reproduces the error envelope (M§3).
- **Generic filtering/sort** (A§4.3 — the de-facto search): a `QueryParsePipe` reproduces the operators (`ne,lt,lte,gt,gte,contains,istartswith,iendswith,isnull,not_in,in`, comma-lists, `ordering`) but against a **per-resource allowlist** (closes D11) instead of any model field.
- **Versioning:** URI versioning (`/api/v1`); new breaking shapes go to `/api/v2` so the frozen v1 contract stays stable.
- **Swagger** via `@nestjs/swagger` at `/api/docs` (replaces drf-spectacular, M§8).
- **Idempotency (review #10):** an `Idempotency-Key` header is honored on non-idempotent, high-stakes endpoints — `users/invite`, `bulk-save`/AI generation, imports, and any future payment route. The key + first response are cached in Redis (TTL); retries return the original result instead of duplicating side effects (a real risk given the frontend's auto-retry-on-401, A§13).
- **Bespoke endpoints preserved:** `notifications/mark-all-read`, file `preview/view/download`, `bulk-save`, `users/invite`, the three `email/send-*` (now enqueue), auth set (A§14).

---

## 9. WebSocket Architecture **[secured — fixes A§7/D2,D10]**

**Transport:** NestJS `WebSocketGateway` (Socket.IO) + `@socket.io/redis-adapter` for horizontal fan-out (replaces channels-redis, M§7). Path/`frame` shape preserved: client sends `{action:'subscribe'|'unsubscribe', channels:[...]}`; server emits `{event, payload, channels, timestamp}` (A§7.1).

**Rooms = authorized channels.** A subscribe request is **validated** before the socket joins a room (the central fix for D2):
- `tasks` (collection) and `tasks.<id>` (entity) rooms are **scoped to a workspace**: the gateway only lets a socket join `tasks` for workspaces it is an ACTIVE member of, and resolves entity rooms to their workspace before admitting. Practically, collection subscriptions become **workspace-qualified rooms** (`ws.<wsId>.tasks`) internally while keeping the public channel name in the frame for frontend compatibility.
- Anonymous sockets are rejected (parity with A§7, close 4401).

**Broadcast source = domain events, not signals** (§11): a `RealtimeSubscriber` listens to domain events and emits to the correct workspace rooms with a **full, contract-consistent payload** built from the Response DTO (fixes D10 — today's `_safe_serialize` drops relations). Broadcasts are **commit-gated** (emitted after the service transaction commits, fixing the pre-commit phantom-event bug, D10).

**Cache invalidation:** frame `event`+`channels` continue to drive TanStack Query invalidation exactly as today (A§7.1); per-entity rooms allow targeted invalidation, collection rooms allow list invalidation.

---

## 10. Queue Architecture **[NEW build — A§8: zero Celery tasks today]**

**BullMQ** (Redis) with isolated queues, consumed by `apps/worker` (M§6.2):

| Queue | Trigger | Job(s) | Retry/Backoff | Idempotency |
|---|---|---|---|---|
| `email` | Auth/Invitations/Notifications services (replaces inline Resend, D7) | invitation, welcome, reset, generic | 5×, exp backoff | dedupe key = (template,to,entityId) |
| `notification` | event subscribers | create + persist + WS push | 3× | jobId = eventId |
| `reminder` | repeatable (cron) | task-due / sprint-end | 3× | jobId = (entity,window) |
| `deadline` | repeatable | overdue scans → notifications | 3× | jobId = day+entity |
| `attendance` | repeatable (daily) | roll-up / mark-absent | 3× | jobId = (date,wsId) |
| `ai` | AiModule (if generation moves server-side) | long generation | 2×, long timeout | jobId = requestId |
| `git` | Integration webhooks | fetch commits, auto-update status | 5× | jobId = (provider,deliveryId) |
| `webhook` | inbound webhook controllers | verify + dispatch provider payloads (review #6) | 5× | jobId = (provider,deliveryId) |
| `export` | reports/analytics requests | generate CSV/PDF, upload, notify (review #6) | 3× | jobId = exportRequestId |
| `import` | bulk import endpoints | parse + validate + upsert + report (review #6) | 3× | jobId = importRequestId |

**Monitoring:** Bull Board dashboard (admin-guarded), Prometheus metrics per queue (depth, failures, latency), structured logs with `jobId`. **Idempotency** via deterministic `jobId`s + upserts so retries are safe.

---

## 11. Event-Driven Architecture **[NEW — replaces A§7 global signals]**

Domain events are first-class contracts in `packages/shared/events` (review #2). They carry **business meaning, not field diffs** (review #5) — there is **no generic `*Updated`**, so subscribers/workers never inspect payloads to infer what happened:
```
WorkspaceMemberAdded, WorkspaceMemberRoleChanged, InvitationAccepted, JoinRequestApproved,
ProjectCreated, ProjectArchived, RequirementCreated, RequirementApproved,
TaskCreated, TaskAssigned, TaskMoved, TaskCompleted, TaskDeleted, TaskCommentAdded,
SprintStarted, SprintCompleted,
LeaveRequested, LeaveApproved, LeaveRejected,
AttendanceCheckedIn, AttendanceCheckedOut, TimeEntrySubmitted, TimeEntryApproved,
NotificationCreated, GitCommitLinked
```
Services emit events **after commit** (§4 side-effect rule) via `EventEmitter2` (in-process now; swappable to a Redis stream/outbox later, §22). Because each event already names the business fact, a subscriber subscribes to exactly the events it cares about (e.g. `NotificationSubscriber` reacts to `TaskAssigned`, not "task changed, let me diff it"). Subscribers are decoupled:
- `RealtimeSubscriber` → Socket.IO rooms (§9).
- `NotificationSubscriber` → enqueue `notification` jobs (replaces client-created notifications, A§6.10/D9).
- `AuditSubscriber` → write `ActivityLog` (replaces client-written audit, A§6.11/D9) — now a server-side guarantee.
- `IntegrationSubscriber` → enqueue `git`/Discord side effects.

This removes the implicit "any model save broadcasts" magic (A§7) and the tight coupling it created (A§11.1): modules never call each other directly.

---

## 12. Background Jobs

Owned by `apps/worker` (separate process & Docker image, M§1). Each processor is a small class per queue (§10). Scheduling via **BullMQ repeatable jobs** (cron-like) — replaces the **absent** Celery beat (A§8). Concurrency tuned per queue; graceful shutdown drains in-flight jobs. The worker shares Prisma + Redis but **never serves HTTP** (the brief's one mandated boundary).

---

## 13. Infrastructure

Docker-based (A§3 parity, M§8):
```
services: api, worker, postgres, redis, nginx, (minio|s3)
```
- **api**: Node image, runs Nest HTTP+WS; health `/api/v1/health` (liveness/readiness with DB+Redis checks).
- **worker**: same codebase, `node worker`; health via BullMQ heartbeat.
- **postgres**, **redis**: managed or container. Redis is partitioned by **logical DB (review #12): `DB0` app cache · `DB1` BullMQ · `DB2` Socket.IO adapter** — clean separation, independent flush, simpler ops (today everything shares one db, A§3).
- **nginx/Caddy**: TLS, reverse proxy, **WebSocket upgrade**, gzip.
- **storage**: all blob access goes through a single `StorageService` abstraction with pluggable drivers (S3/MinIO/Cloudflare/local). **Modules never call a storage SDK directly (review #15)**; local-disk driver in dev (replaces django-storages, M§8).
- **Env**: Zod-validated `packages/config`; secrets via env/secret manager.
- **Logging**: pino (JSON) → aggregator; **Monitoring**: Prometheus + Grafana (HTTP, queue, WS metrics), Sentry for errors.

---

## 14. Deployment

- **Build:** turborepo/pnpm; two Docker images (`api`, `worker`) from one repo.
- **Migrations:** `prisma migrate deploy` as a pre-deploy step/job; data migration scripts for ID/soft-FK backfill (§20).
- **Rollout:** blue-green or rolling; API and Worker deploy independently. WS sessions tolerate restarts via Redis adapter + client reconnect/backoff (already implemented frontend-side, A§7.1).
- **Config:** 12-factor env; `/api/v1/health` gates readiness.

---

## 15. Security

| Control | Implementation | Audit driver |
|---|---|---|
| Token revocation | server-tracked refresh `jti` in Redis; rotation revokes old (§6) | **D1** |
| Authorized realtime | room-level workspace authorization (§9) | **D2** |
| RBAC enforcement | policy guards on every mutating route (§7) | **D3** |
| Secret encryption | integration `accessToken` encrypted at rest (KMS/`pgcrypto`/app-level) | **D4** |
| Workspace scoping completeness | add `workspaceId` to `ActiveTimer` + integration models; scope all repos (§4,§7) | **D5** |
| Input validation | global `ValidationPipe` + per-resource filter allowlist | **D11** |
| Transport | Helmet, HSTS (prod), strict CORS `credentials:true` to known origins (parity A§3) | A§3 |
| CSRF | cookie-auth CSRF strategy (double-submit) preserving frontend `X-CSRFToken` use (A frontend) | A frontend |
| Passwords | argon2id; keep `validate_password` rules; temp-password invite flow preserved (A§5.3) | A§5.3 |
| Least privilege | DB user scoped; worker/API separated | §1 |

---

## 16. Scalability

- **API** is stateless → horizontal scale behind nginx; **Socket.IO Redis adapter** makes WS multi-instance safe (today's single Daphne is a bottleneck, A§3).
- **Worker** scales per-queue concurrency independently of API (decouples write latency from side effects — fixes the inline-fan-out/inline-email cost, A§7/A§8).
- **DB**: read replicas for heavy list/analytics later; connection pooling (PgBouncer).
- **Realtime** fan-out moves off the request path (events post-commit) — removes the synchronous 2-Redis-sends-per-write cost and the bulk-save event storm (A§11.2).

---

## 17. Performance Optimizations

- Kill N+1 from `SerializerMethodField`s (`memberIds`, `workspaceIds`, file `url`, A§11.2) via Prisma `include`/`select` and batched lookups.
- Cache workspace-membership lookups (issued on **every** domain request today, A§11.2) in Redis with event-based invalidation (§18).
- Allowlisted, index-backed filtering (no arbitrary-field scans, D11).
- Commit-gated, batched realtime emits; coalesce bulk-save into a single tree-created event instead of per-row storms (A§7.2).
- Cursor pagination option for large lists (keep page envelope for v1).

### 17.1 CQRS — scoped, not global

We **do not** adopt CQRS as a system-wide pattern. For the entire transactional domain (tasks, leave, workspaces, …) commands and queries share the same services and Prisma models; splitting them everywhere would multiply code for no benefit on a fundamentally CRUD-shaped product (A§1).

We **do** introduce read-side projections **selectively, only for read-heavy dashboards and reports** — workspace analytics, sprint burndown, time/attendance summaries — where (a) the query aggregates across many tables and (b) the read pattern diverges sharply from the write model. There, a denormalized **read model** (a Postgres materialized view or an event-fed projection table, invalidated via domain events §11) serves the dashboard without taxing the write path. Everything else stays single-model. This is "CQRS where it pays," not architecture-wide — and it is additive (no such analytics engine exists today, A§12).

---

## 18. Caching Strategy

| Layer | What | Invalidation |
|---|---|---|
| Redis cache (DB0) | workspace membership & permission sets (hot path, A§11.2) | on `WorkspaceMemberAdded` / `WorkspaceMemberRoleChanged` events |
| Redis cache (DB0) | reference data (holidays, labels, kanban columns) | on entity events |
| HTTP | `ETag`/`Cache-Control` for immutable file responses | content-addressed |
| Client | TanStack Query (unchanged) invalidated by WS events (A§7.1) | WS frame `event/channels` |

No caching exists today beyond Channels' Redis use (A§11.2); all of the above is additive and event-invalidated to avoid staleness.

---

## 19. Testing Strategy **[NEW — A§D16: no tests exist]**

1. **Contract tests first:** generate a frozen-contract suite from `frontend/src/lib/api/*` and the live Django API (camel fields, envelopes, slugs, WS frames) — the safety net before porting (A§13).
2. **Characterization tests** per module: capture current Django responses, assert NestJS parity (including the deliberate auth bypasses, A§13 — reproduce, then tighten with explicit tests for the security fixes).
3. **Unit** (Jest) for services/policies/hierarchy-id logic; **integration** for repositories against a test Postgres; **e2e** (Supertest + Socket.IO client) for auth, scoping, realtime authorization.
4. **Migration tests:** ID-generator byte-parity (§4), soft-FK backfill correctness.

---

## 20. Migration Plan (Django → NestJS, incremental, module-by-module)

**Strategy: Strangler Fig.** Stand up NestJS alongside Django; route collections to NestJS one module at a time behind nginx; keep the same Postgres (Prisma `introspect` the existing schema, A§9) so **no data move** is needed initially — only string-PK/ID-gen parity (§4).

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | Monorepo scaffold, `packages/common` (id-gen byte-parity, envelopes, query pipe), Prisma introspect, contract+characterization harness (§19) | Health + Swagger up; contract suite green against Django |
| 1 | Auth + Users (M§1,§6) incl. **D1 fix** behind a flag; cookie/refresh parity with frontend `tryRefresh` | Login/refresh/me parity; tokens revocable |
| 2 | Workspaces + RBAC (§7) incl. invitation/join workflows **[NEW]**; `WorkspaceGuard` scoping parity | Membership scoping identical; policies enforced |
| 3 | Projects → Requirements → Epics → Sprints → Tasks (+ kanban/labels/comments); promote soft FKs (nullable) + backfill | Parity per module; integrity added without breaking lists |
| 4 | Realtime gateway with **authorized rooms** (§9, D2) + event bus (§11); cut over WS | Frontend realtime works; no cross-workspace leakage |
| 5 | Attendance/Leave/TimeTracking with **server-side computation & approval** [NEW, D9]; reconcile against `leave-utils.ts` | Computed values match, then server becomes source of truth |
| 6 | Notifications/Activity engines (event-driven) [NEW, D9]; email queue (D7) | Server emits notifications/audit; email queued |
| 7 | Files (storage abstraction) + Integrations **webhooks/Git queue [NEW]** + token encryption (D4) | Uploads/streaming parity; webhooks live |
| 8 | Generation (`bulk-save`) port (exact hierarchy-id/classification, A§4.9); decommission Django | Tree creation parity; Django retired |

Each phase: ship behind nginx routing + feature flags, run parity tests, then flip.

---

## 21. Risks & Trade-offs

| Risk / Trade-off | Stance |
|---|---|
| **Contract drift** (A§13) | Frozen v1 + contract tests; breaking changes only in v2 |
| **Soft-FK promotion exposes orphans** (A§9.2) | Nullable relations + backfill before enforcement; never hard-fail on legacy `""` |
| **Moving rules server-side changes results** (A§10/D9) | Port exact formulas, run dual-source reconciliation, then switch authority |
| **Security fixes change behavior** (D1,D2,D3) | Reproduce current behavior first (tests), then tighten with explicit, reviewed toggles |
| **Modular monolith vs microservices** | Chosen monolith (no existing boundaries, A§11.1); accept coupling-in-process for speed, keep event seams for §22 |
| **Django admin dropped** (M§8) | Replace with admin API endpoints; flagged as scope, not silently lost |
| **Greenfield queues/integrations** (A§8/§6.12) | Treated as new build with their own tests, not assumed-working ports |
| **Dual-run cost** (strangler) | Temporary infra overhead accepted for zero-downtime, reversible migration |

---

## 22. Future Microservice Extraction Opportunities

Seams already created by the event bus (§11) and worker split (§1), in likely extraction order:
1. **Notifications + Email** — already event-driven and async; extract first (clear input = events, output = email/WS).
2. **Integrations/Git** — bounded, webhook-driven, independent scaling and failure domain.
3. **AI** — `AiModule` (model/prompt infrastructure) is already separated from `GenerationModule` business logic (review #14); long-running and resource-heavy, so it is the natural early extraction (A§4.9).
4. **Realtime gateway** — can become a standalone Socket.IO tier fed by Redis streams.
5. **Files** — storage/streaming service.

Core domain (workspaces, projects, tasks, HR) stays monolithic until scale or team boundaries justify splitting — the audit shows one cohesive, membership-scoped domain (A§1), so premature extraction there would add cost without benefit.

---

## Appendix A — Architecture Decision Records (ADRs)

Major decisions are recorded as MADR-style ADRs under [`docs/adr/`](docs/adr/) — see [docs/adr/README.md](docs/adr/README.md). Each ADR is immutable once **Accepted**; a changed decision is captured by a new ADR that *supersedes* the old one (never an in-place edit), so the reasoning history stays intact.

| ADR | Decision | Status | Doc §/Audit ref |
|---|---|---|---|
| [0001](docs/adr/0001-modular-monolith-api-worker-split.md) | Modular monolith with API/Worker split (not microservices) | Accepted | §1 / A§11.1 |
| [0002](docs/adr/0002-preserve-string-primary-keys.md) | Preserve 20-char string primary keys | Accepted | §4 / A§9.1 |
| [0003](docs/adr/0003-freeze-v1-rest-ws-contract.md) | Freeze the v1 REST/WS contract | Accepted | §8,§9 / A§13 |
| [0004](docs/adr/0004-controller-service-prisma-repository-optional.md) | Controller→Service→Prisma; repository opt-in | Accepted | §2,§5 |
| [0005](docs/adr/0005-policy-based-rbac-normalized-permissions.md) | Policy-based RBAC with normalized permissions | Accepted | §7 / A§5.5 |
| [0006](docs/adr/0006-authorized-realtime-via-domain-events.md) | Authorized realtime rooms via domain events | Accepted | §9,§11 / A§7 |
| [0007](docs/adr/0007-bullmq-async-commit-then-emit.md) | BullMQ async + commit-then-emit (no side effects in tx) | Accepted | §4,§10 / A§8 |
| [0008](docs/adr/0008-promote-soft-fks-to-relations.md) | Promote soft FKs to nullable relations + backfill | Accepted | §4 / A§9.2 |
| [0009](docs/adr/0009-cookie-jwt-revocable-refresh.md) | Cookie JWT with server-tracked revocable refresh tokens | Accepted | §6 / A§5.3 |
| [0010](docs/adr/0010-strangler-fig-migration.md) | Strangler-fig, dependency-ordered migration | Accepted | §20 / M§9 |
| [0011](docs/adr/0011-cqrs-scoped-to-dashboards.md) | CQRS scoped to read-heavy dashboards only | Accepted | §17.1 |
| [0012](docs/adr/0012-application-services-orchestration.md) | Application Services for cross-module orchestration | Accepted | §3.1 |

---

*End of Target Architecture. Implementation begins after approval; scaffolding follows the Phase 0 plan in §20.*
