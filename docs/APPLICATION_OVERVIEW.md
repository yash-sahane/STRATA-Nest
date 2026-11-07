# STRATA — Application Overview

Architecture, user flows and tech stack of STRATA, in one place. For the decisions
behind the architecture see [adr/](adr/); for the short backend summary see
[ARCHITECTURE_SUMMARY.md](ARCHITECTURE_SUMMARY.md).

STRATA is a single platform for project management and HR. It covers Scrum delivery
(requirements → epics → sprints → tasks), HR (attendance, leave, timesheets), Git
integrations, real-time collaboration, and AI that turns a requirements document into a
full project plan.

---

## 1. Tech stack

| Layer | Technology |
|---|---|
| **Monorepo** | pnpm 10 workspaces, Node ≥ 20, TypeScript 5.5 |
| **Frontend** | Next.js 16 (App Router), React 19, TanStack Query 5, Tailwind and Radix UI (shadcn-style), react-hook-form with zod, Recharts, `@hello-pangea/dnd` (Kanban drag-and-drop), cmdk (⌘K palette), sonner (toasts), next-themes |
| **AI** | `@google/generative-ai` (Gemini, default `gemini-3.6-flash`), with a Hugging Face endpoint as fallback; `pdf2json` for PDF upload |
| **API** | NestJS 10 on Express, `@nestjs/platform-ws` (plain WebSocket, not Socket.IO), Passport-JWT, class-validator, Swagger, `@nestjs/throttler`, `@nestjs/event-emitter`, helmet, nestjs-pino |
| **Worker** | NestJS app context with no HTTP, BullMQ consumers, Resend for email |
| **Data** | PostgreSQL 16 with Prisma 5 (the schema is split across 15 `.prisma` files) |
| **Cache / queues** | Redis 7 with ioredis. DB0 holds cache, sessions, rate limits and real-time fan-out; DB1 holds BullMQ queues |
| **Infra** | Docker Compose (postgres, redis, one-shot migrate, api, worker, frontend, nginx), nginx reverse proxy, k6 load test |
| **Quality** | Jest unit tests, a contract-test package that locks the v1 wire format, a Playwright-driven e2e suite in `e2e/` (`.mjs` scripts), GitHub Actions CI (typecheck → lint → unit tests → build, plus `pnpm audit` and a Docker build; the API e2e step exists but is disabled) |

### Repository layout

```
apps/
  frontend/   Next.js app (App Router) + AI and PDF server routes
  api/        NestJS HTTP API + raw WebSocket gateway
  worker/     BullMQ consumers (email, git) — no HTTP
packages/
  common/          HTTP envelopes, exception filter, date/id helpers, sanitising pipes
  config/          env schema, validated at boot
  shared/          domain events, queue contracts, wire types
  prisma/          schema, migrations, seed, PrismaService
  contract-tests/  wire-contract regression suite
e2e/        browser regression suite (drives the running stack)
infra/      docker/, nginx/, loadtest/
docs/       this file, architecture summary, ADRs, release runbooks
```

---

## 2. System architecture

```
                         ┌────────────────────────────────────────┐
  Browser ──────────────▶│ Next.js frontend (:3000)               │
     │                   │  • App Router pages (client components)│
     │                   │  • /api/ai-generate  → Gemini / HF     │
     │                   │  • /api/parse-pdf    → pdf2json        │
     │                   └────────────────────────────────────────┘
     │  REST (cookies, credentials:'include')  +  WebSocket
     ▼
  nginx (:80)  /api/* , /ws/*  ──▶  apps/api  NestJS (:8000, prefix /api/v1)
                                     │  Guards: Throttle → JWT → Permissions
                                     │  Controller → Service → Prisma
                                     │  EventEmitter (domain events)
                                     │  WS gateway /ws/collections/
                                     │
             ┌───────────────────────┼─────────────────────────┐
             ▼                       ▼                         ▼
       PostgreSQL 16           Redis DB0                  Redis DB1 (BullMQ)
       (packages/prisma        rate limits, refresh        queues: email, git
        owns migrations)       tokens, WS pub/sub                │
             ▲                       ▲                           ▼
             │                       └── strata:worker-events ── apps/worker
             └────────────────────────────────────────────────── (Email → Resend,
                                                                  Git → commits/tasks)
```

### Key architectural decisions

- **Modular monolith with an API/worker split ([ADR-0001](adr/0001-modular-monolith-api-worker-split.md)).**
  One API process with about 22 domain modules, plus a separate worker for slow or
  retryable jobs. Deliberately not microservices.
- **Controller → Service → Prisma ([ADR-0004](adr/0004-controller-service-prisma-repository-optional.md)).**
  Repositories are added only where a module needs one. Cross-module work such as
  deletion goes through application services ([ADR-0012](adr/0012-application-services-orchestration.md)).
- **Frozen v1 contract ([ADR-0003](adr/0003-freeze-v1-rest-ws-contract.md)).**
  - Paginated responses look like `{items,total,page,pageSize}` and errors like `{error:{message,code,type}}`.
  - JSON is camelCase, and dates are ISO strings with microseconds.
  - WebSocket frames look like `{event,payload,channels,timestamp}`.
  - [packages/contract-tests](../packages/contract-tests) enforces all of this.
- **20-character string primary keys** ([ADR-0002](adr/0002-preserve-string-primary-keys.md)) and
  **human-readable hierarchy IDs**, minted by the server in
  [hierarchy-ids.ts](../apps/api/src/modules/generation/hierarchy-ids.ts). Examples:
  `ECOM-EPIC-03`, `ECOM-SHO-CHE-CRD-04`, `…-BLD-02`.
- **Commit, then emit ([ADR-0007](adr/0007-bullmq-async-commit-then-emit.md)).** Side effects
  such as queueing jobs, sending real-time frames and deleting files never run inside a
  DB transaction.

### API domain modules

`apps/api/src/modules`: auth · authz · users · workspaces · projects · requirements ·
epics · sprints · tasks · attendance · leave · time-tracking · notifications · activity ·
files · storage · integrations · generation · email · mail · realtime · deletion.

### Shared packages

| Package | Role |
|---|---|
| [packages/config](../packages/config/src/env.schema.ts) | A zod env schema checked when the app starts; it fails immediately if something is wrong. In production it refuses to boot with secrets shorter than 32 characters or with insecure cookies |
| [packages/common](../packages/common/src) | HTTP envelopes, `AllExceptionsFilter`, date/ID helpers, sanitising pipes |
| [packages/shared](../packages/shared/src) | Domain event names (Workspace, Auth, Planning, Task, Requirement, HR), BullMQ queue contracts, wire types |
| [packages/prisma](../packages/prisma) | Schema, migrations, seed, `PrismaService` with a **write hook** that real-time subscribes to |

### API request pipeline

Defined in [main.ts](../apps/api/src/main.ts) and [app.module.ts](../apps/api/src/app.module.ts).

1. **Request-level middleware:**
   - pino logging with an `X-Request-Id` correlation ID; passwords and cookies are removed from logs
   - helmet (with HSTS in production)
   - CORS and an **origin check**: CORS controls who can read a response, the origin check controls who can trigger a write
   - cookie-parser and a 4 MB body limit
2. **Global pipes:** `StripLoneSurrogatesPipe` runs first, then `ValidationPipe` with whitelisting.
3. **Global guards, in this order:**
   1. `AuthThrottlerGuard`: rate limiting stored in Redis, so limits are shared across replicas
   2. `JwtAuthGuard`: authentication, skipped for routes marked `@Public`
   3. `PermissionsGuard`: checks `@RequirePermission` against the caller's role in that workspace
4. **Exceptions:** `AllExceptionsFilter` turns every error into the frozen error envelope.

### Data model

Schema files live in [packages/prisma/schema](../packages/prisma/schema).

```
User ─┬─ WorkspaceMember ── Workspace ─┬─ WorkspaceRole (custom roles, JSON perms)
      │                                ├─ InviteCode / JoinRequest
      │                                └─ Project ─┬─ ClientRequirement
      │                                            │     └─ FunctionalRequirement (← epic, sprint)
      │                                            ├─ Epic (← requirement)
      │                                            ├─ Sprint
      │                                            ├─ Task ── TaskComment  (← sprint, epic, FR; sub-tasks)
      │                                            ├─ GitHub/GitLab/DiscordIntegration ── GitCommit
      │                                            └─ UploadedFile
      ├─ Attendance, LeaveRequest, LeaveBalance, Holiday        (HR)
      ├─ TimeEntry, ActiveTimer                                 (time)
      ├─ Notification, NotificationPreference
      └─ ActivityLog, RetentionArchive, IdempotencyKey
```

The lines above are logical links. The Prisma schema declares no `@relation`s: each link is a
plain string ID column (many default to `""`), and the database foreign keys were added in the
raw-SQL migration `20260101000001_fk_index_parity`.

| Schema file | Models |
|---|---|
| `identity.prisma` | User |
| `workspace.prisma` | Workspace, WorkspaceMember, WorkspaceRole, InviteCode, JoinRequest |
| `project.prisma` | Project |
| `requirement.prisma` | ClientRequirement, FunctionalRequirement |
| `planning.prisma` | Epic, Sprint |
| `task.prisma` | Task, TaskComment |
| `hr.prisma` | Attendance, Holiday, LeaveRequest, LeaveBalance |
| `time.prisma` | TimeEntry, ActiveTimer |
| `integration.prisma` | GitHubIntegration, GitLabIntegration, DiscordIntegration, GitCommit |
| `notification.prisma` | Notification, NotificationPreference |
| `activity.prisma` | ActivityLog |
| `file.prisma` | UploadedFile |
| `generation.prisma` | IdempotencyKey |
| `retention.prisma` | RetentionArchive |

### Authentication

See the [auth module](../apps/api/src/modules/auth) and [ADR-0009](adr/0009-cookie-jwt-revocable-refresh.md).

- Passwords are hashed with PBKDF2-SHA256. Failed logins are tracked in Redis by `login-attempt.store`.
- Login sets two **httpOnly cookies**: `strata_access` (15 minutes) and `strata_refresh` (7 days).
- Refresh tokens are **tracked on the server in Redis** (`refresh-token.store`), so they
  can be revoked individually or all at once.
- The frontend's [rest-client.ts](../apps/frontend/src/lib/api/rest-client.ts) sends
  `credentials:'include'`. On a 401 it refreshes the session once and retries. It never
  retries for login, refresh and two other endpoints.
- CSRF protection is SameSite=Lax cookies plus the API's origin check on writes. The client
  also sends an `X-CSRFToken` header, but the API never sets or checks one.
- A temporary password forces a visit to `/change-password` (`TempPasswordGuard` on the
  frontend, `@AllowTempPassword` on the backend).

### Authorization

See [permissions.ts](../apps/api/src/modules/authz/permissions.ts) and
[ADR-0005](adr/0005-policy-based-rbac-normalized-permissions.md).

- Permissions are strings such as `task:update` or `leave:approve`, about 30 in total.
- There are 7 built-in roles:

| Group | Roles | Permissions |
|---|---|---|
| Managers | `MANAGER` | All |
| | `ASSISTANT_MANAGER` | All except deleting the workspace |
| Delivery | `SOFTWARE_DEVELOPER`, `DEVELOPER_INTERN`, `TESTER`, `CONTENT_ENGINEER` | The baseline plus creating and updating tasks |
| Read-only | `MEMBER` | The baseline only |

- A workspace can define **custom roles** with their own permission lists. An
  unrecognised role name falls back to the read-only baseline.
- The frontend has a matching role list
  ([role-catalogue.ts](../apps/frontend/src/lib/role-catalogue.ts)), and a parity test
  (`role-catalogue-parity.spec.ts`) keeps the two in sync.

### Real-time

See the [realtime module](../apps/api/src/modules/realtime) and
[ADR-0006](adr/0006-authorized-realtime-via-domain-events.md).

1. The client opens a plain WebSocket to `/ws/collections/`. The cookie is
   authenticated, and anonymous connections are closed with code 4401. Messages that
   arrive before authentication finishes are buffered rather than dropped.
2. The client sends `{action:'subscribe', channels:['tasks','tasks.<id>']}`.
3. Frames are produced from two sources:
   - **Prisma write hook:** every write to a row produces a frame on `collection` and `collection.id`.
   - **Domain events:** `RealtimeSubscriber` bridges business events onto those same channels.
4. Each frame is sent to local sockets and also **published to Redis**, so sockets
   connected to other API instances receive it too.
5. **Security happens when a frame is sent, not when a client subscribes.** A frame only
   reaches sockets whose user belongs to that workspace, and user-scoped collections only
   reach the addressed user. Subscribing to a channel therefore never leaks data.
6. When a frame arrives, the frontend refetches that query through TanStack Query.

### Async work

Queue names and job shapes are defined once in
[packages/shared/src/queue](../packages/shared/src/queue/index.ts).

- **`email` queue.** Covers password reset, welcome, workspace invitation and
  notification emails. The worker sends them through Resend, or only logs them when no
  key is set. An idempotency key is used as the job ID, so a duplicate enqueue does
  nothing.
- **`git` queue:**
  1. The API's webhook endpoint checks the provider's HMAC signature over the raw request body.
  2. It normalises the commits and enqueues a job, using the delivery ID to drop provider re-deliveries.
  3. The worker records each commit once and links it to tasks mentioned in the message.
  4. If the integration has auto-update turned on and the message says it closes the
     task, the worker moves the task from `BACKLOG`, `TODO` or `IN_PROGRESS` to
     **`REVIEW`** (deliberately not `DONE`).
  5. It then publishes on `strata:worker-events`. `WorkerEventsBridge` in the API turns
     that into real-time frames, because the worker has no sockets of its own.
- **Scheduled job.** An interval-based deadline-reminder scheduler runs inside the API.

### Deletion

See the [deletion module](../apps/api/src/modules/deletion).

- **Zone 1:** a single `$transaction` deletes child rows before their parents. HR and
  audit rows are first copied into `retention_archive`.
- **Zone 2:** after the commit, it removes stored files, sends real-time frames and
  purges queued jobs.
- Database foreign keys (`NO ACTION`) act as a final safeguard.

### AI generation

- The model is called only from the Next.js server route
  [`/api/ai-generate`](../apps/frontend/src/app/api/ai-generate/route.ts). The key
  (`GEMINI_API_KEY`, or `HF_API_KEY` for the fallback) lives only in the frontend's server
  environment and never reaches the browser.
- The API never calls a model. Its [generation module](../apps/api/src/modules/generation)
  only persists what the user accepted, through `POST /api/v1/bulk-save`.

---

## 3. User flows

### a) Onboarding

There is no self sign-up. Accounts come from an invitation (`POST /users/invite`, which needs
`member:invite` and gives the new user a temporary password) or from the seed script.

Being added to a workspace by somebody else is an **invitation**: an `INVITED` membership that
grants nothing until the person accepts it (`POST /workspace_members/:id/accept`) or declines it
(`.../decline`). Nobody can answer it for them; a manager can only withdraw it (DELETE). New and
existing accounts are treated alike, so the roster never reveals whether an address already had
an account. Two adds take effect at once: a platform administrator's, and one that answers the
person's own pending request to join. Redeeming an invite code while invited also accepts.

```
/login ─▶ (temp password?) /change-password ─▶ /dashboard
                                                   │ no workspace → WorkspaceGuard
                                                   ▼
                 platform admin ─▶ /onboarding: create a workspace (only admins can)
                 everyone else  ─▶ accept an invitation waiting for them
                                   or enter an invite code (InviteCode)
                                   or request access (JoinRequest → a manager approves)
```

Somebody already in a workspace finds new invitations on `/workspaces`, where the invitation
notice leads.

Forgot password follows `/forgot-password`, then an email from the worker, then `/reset-password`.

### b) Project setup, manual or AI

1. The user creates a project on `/projects`, or **clones** an existing one.
2. **AI path:**
   1. The user uploads a PDF, which `/api/parse-pdf` converts to text.
   2. `/api/ai-generate` calls Gemini with the operator's key.
   3. The user reviews the proposed plan: client requirements, the epics that deliver
      them, the functional requirements under each epic, and their tasks (the same
      client requirement → epic → functional requirement → task chain the app shows
      everywhere else).
   4. On accept, the plan goes to `POST /api/v1/bulk-save`. That endpoint checks
      permissions, mints hierarchy IDs and writes everything atomically. An
      `IdempotencyKey` stops a double submit from creating everything twice.
3. A project's own details (name, client, status, dates) are edited at
   `/projects/[id]/settings`. GitHub, GitLab and Discord integrations are connected per
   project under **Settings → Integrations** (pick the project there).

### c) Delivery loop (Scrum)

```
/requirements, /functional-requirements  →  /epics  →  /sprints
     │                                                    │
     └──────────────────────────────▶ /sprints/[id]/backlog   (plan: pick the functional requirements; their open tasks follow)
                                       /sprints/[id]/board     (Kanban DnD: BACKLOG→TODO→IN_PROGRESS→REVIEW→DONE)
                                       /sprints/[id]/analytics (burndown, velocity)
```

- On `/tasks`, users can comment, add dependencies, attach files and use review flows.
  The API also accepts sub-tasks (`parentTaskId`), but no screen creates them yet.
- Delivery roles can create and update tasks. Only managers (`task:write`) can delete
  tasks or mark them done.
- Starting or completing a sprint emits `PlanningEvents`. Subscribers turn those into
  notifications, activity-log entries and real-time frames.
- A Git commit that says `fixes #ECOM-T07` moves that task to REVIEW automatically, as
  described under [Async work](#async-work). The `#` matters: a bare reference is only
  recognised in the `ABC-123` shape, so `ECOM-T07` without it links nothing.

### d) HR and time

- **`/attendance`:** check in and out, a calendar, holidays, and a team view for managers.
- **`/leave`:**
  1. The employee submits a request, which emits `HrEvents.LeaveRequested`.
  2. The manager gets a notification and an email.
  3. The manager approves or rejects, which needs `leave:approve`.
  4. Leave balances update.
- **`/time-tracking`:** live timers (`ActiveTimer`) and time entries. Managers approve
  entries (`time:approve`).

### e) Awareness

- **`/dashboard`:** figures are computed in the browser from the full task list; the read
  models [ADR-0011](adr/0011-cqrs-scoped-to-dashboards.md) describes are not built.
- **`/analytics`, `/team`, `/calendar`:** reporting and team views.
- **`/activity`:** the workspace audit trail.
- **Notifications:** an in-app bell with per-user preferences, plus email.
- **⌘K command palette:** global search.
- **Live permission updates:** when a manager changes someone's role,
  `useMyAccessRealtime` updates what they can see on whatever screen they are on.

### Frontend routes

| Group | Routes |
|---|---|
| Auth | `/login`, `/forgot-password`, `/reset-password`, `/change-password` |
| Workspace | `/onboarding`, `/workspaces`, `/team`, `/settings`, `/profile` |
| Delivery | `/projects`, `/projects/[projectId]`, `/projects/[projectId]/settings`, `/requirements`, `/functional-requirements`, `/epics`, `/sprints`, `/sprints/[id]/backlog`, `/sprints/[id]/board`, `/sprints/[id]/analytics`, `/tasks` |
| HR and time | `/attendance`, `/leave`, `/time-tracking` |
| Overview | `/dashboard`, `/analytics`, `/calendar`, `/activity` |
| Server routes | `/api/ai-generate`, `/api/parse-pdf` |

---

## 4. Development and deployment

| Mode | Commands | Result |
|---|---|---|
| Everything in containers | `pnpm stack:up` | postgres → migrate and seed → api, worker → frontend → nginx |
| Apps on the host | `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev` | Postgres on :5433, Redis on :6379, API on :8000, frontend on :3000 |

- Swagger is at `/api/docs` (outside production only).
- Seeded login: `admin@strata.local` / `ChangeMe123!`, plus `role.<role>@strata.local` /
  `RolePass123!` for each of the 7 roles (never created in production).
- `pnpm demo:data` builds a "Demo Company" workspace with sample data.
- Runbooks (deploy, rollback, disaster recovery, on-call, observability) are in
  [release/](release/).
