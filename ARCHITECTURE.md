# L-T-Connect-2 — Architecture & System Documentation

> Full-stack project management platform built with Next.js 16 + Django 5.1.
> Covers SCRUM workflow, HR (attendance/leave), time tracking, and real-time collaboration.

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Folder Structure](#2-folder-structure)
3. [Backend Architecture](#3-backend-architecture)
   - [Settings & Config](#31-settings--config)
   - [API URL Structure](#32-api-url-structure)
   - [Django Models & Relationships](#33-django-models--relationships)
4. [Frontend Architecture](#4-frontend-architecture)
   - [App Router Layout](#41-app-router-layout)
   - [Page Routes](#42-page-routes)
   - [Components](#43-components)
   - [Providers & Context](#44-providers--context)
   - [Utilities & Hooks](#45-utilities--hooks)
5. [Authentication Flow](#5-authentication-flow)
6. [Real-Time Architecture](#6-real-time-architecture)
7. [User Flows](#7-user-flows)
   - [Onboarding](#71-onboarding)
   - [Project & Sprint Lifecycle](#72-project--sprint-lifecycle)
   - [Requirement Hierarchy](#73-requirement-hierarchy)
   - [Leave Management](#74-leave-management)
   - [Attendance & Time Tracking](#75-attendance--time-tracking)
8. [Permission System](#8-permission-system)
9. [Infrastructure & Deployment](#9-infrastructure--deployment)
10. [Data Flow Diagram](#10-data-flow-diagram)

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16, React 19, TypeScript 6 |
| **Styling** | Tailwind CSS v4, Radix UI primitives |
| **State / Data** | TanStack React Query v5 |
| **Backend** | Django 5.1, Django REST Framework 3.15 |
| **ASGI Server** | Daphne (HTTP + WebSocket) |
| **Database** | PostgreSQL 16 (port 5433) |
| **Cache / Realtime** | Redis 7 (Channels layer + Celery broker) |
| **WebSockets** | Django Channels 4 |
| **Auth** | JWT (SimpleJWT) via httpOnly cookies |
| **Task Queue** | Celery 5 + Celery Beat |
| **Email** | Resend API |
| **Storage** | Local filesystem or AWS S3 (configurable) |
| **Charts** | Recharts |
| **AI** | Google Generative AI (task generation) |
| **Testing** | Playwright (e2e) |

---

## 2. Folder Structure

```
L-T-Connect-2/
├── backend/
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py          # All settings: apps, middleware, DRF, JWT, Channels, Redis
│   │   │   ├── dev.py           # Development overrides
│   │   │   └── prod.py          # Production overrides
│   │   ├── urls.py              # Root URL router → /api/v1/
│   │   ├── asgi.py              # Daphne + Channels WebSocket routing
│   │   ├── wsgi.py
│   │   └── celery.py            # Celery app setup
│   ├── apps/
│   │   ├── core/                # Base models, permissions, pagination, exceptions, bulk-save
│   │   ├── accounts/            # User auth, login, register, password reset, profile
│   │   ├── workspaces/          # Workspace, members, roles, invitations, join requests
│   │   ├── projects/            # Project model (SCRUM methodology)
│   │   ├── tasks/               # Task, TaskComment, KanbanColumn, Label
│   │   ├── sprints/             # Sprint, Retrospective
│   │   ├── epics/               # Epic (links to ClientRequirement)
│   │   ├── requirements/        # ClientRequirement, FunctionalRequirement
│   │   ├── leave/               # LeaveRequest, LeaveBalance
│   │   ├── attendance/          # Attendance, Holiday
│   │   ├── time_tracking/       # TimeEntry, ActiveTimer (timer + Pomodoro)
│   │   ├── notifications/       # Notification model + delivery
│   │   ├── activity/            # ActivityLog, SavedSearch
│   │   ├── files/               # UploadedFile, S3-compatible storage
│   │   ├── integrations/        # GitHub, GitLab, Discord, GitCommit
│   │   ├── emails/              # Resend-based email service
│   │   └── realtime/            # Channels WebSocket consumers + signal handlers
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .env
│
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx                    # Root: Theme + Query + Auth providers
    │   │   ├── (auth)/
    │   │   │   ├── login/page.tsx
    │   │   │   └── change-password/page.tsx
    │   │   └── (dashboard)/
    │   │       ├── layout.tsx                # Sidebar + Header + CommandPalette + WorkspaceGuard
    │   │       ├── dashboard/page.tsx
    │   │       ├── profile/page.tsx
    │   │       ├── onboarding/page.tsx
    │   │       ├── projects/
    │   │       │   ├── page.tsx
    │   │       │   └── [projectId]/
    │   │       │       ├── page.tsx
    │   │       │       └── settings/page.tsx
    │   │       ├── sprints/
    │   │       │   ├── page.tsx
    │   │       │   └── [id]/
    │   │       │       ├── board/page.tsx
    │   │       │       ├── backlog/page.tsx
    │   │       │       └── analytics/page.tsx
    │   │       ├── tasks/page.tsx
    │   │       ├── epics/page.tsx
    │   │       ├── requirements/page.tsx
    │   │       ├── functional-requirements/page.tsx
    │   │       ├── attendance/
    │   │       │   ├── page.tsx
    │   │       │   └── team/page.tsx
    │   │       ├── leave/page.tsx
    │   │       ├── calendar/page.tsx
    │   │       ├── team/page.tsx
    │   │       ├── analytics/
    │   │       │   ├── page.tsx
    │   │       │   ├── team/page.tsx
    │   │       │   └── workspace/page.tsx
    │   │       ├── activity/page.tsx
    │   │       ├── workspaces/page.tsx
    │   │       └── settings/page.tsx
    │   ├── components/
    │   │   ├── ui/               # Radix-based primitives (50+ components)
    │   │   ├── providers/        # AuthProvider, QueryProvider, ThemeProvider, WorkspaceProvider
    │   │   ├── layout/           # Sidebar, Header, PageHeader
    │   │   ├── guards/           # WorkspaceGuard
    │   │   ├── tasks/            # Create/Edit/Details dialogs, TaskBoard, TaskDependencies
    │   │   ├── projects/         # Create/Edit/Clone dialogs, ProjectHealth
    │   │   ├── sprints/          # Create dialog, SprintBoard, BurndownChart, FRAssignment
    │   │   ├── requirements/     # ClientReq + FR create/detail dialogs
    │   │   ├── epics/            # CreateEpic, EpicDetail
    │   │   ├── leave/            # LeaveRequestForm, LeaveBalance, LeaveApprovalCard
    │   │   ├── attendance/       # Calendar, Stats, TeamAttendance, Widget
    │   │   ├── time-tracking/    # TaskTimeTracking, ManualTimeEntry
    │   │   ├── team/             # AddMembers, ResourceAllocation, DeleteMember
    │   │   ├── workspace/        # WorkspaceSwitcher, InviteMember, DeleteWorkspace
    │   │   ├── notifications/    # NotificationCenter, DeadlineReminderChecker
    │   │   ├── activity/         # ActivityFeed
    │   │   ├── analytics/        # KPIWidgets
    │   │   ├── search/           # CommandPalette, SearchHighlight, SearchHistory
    │   │   └── ai/               # AIGenerateDialog
    │   ├── lib/
    │   │   ├── api/
    │   │   │   ├── rest-client.ts      # Fetch wrapper with auto-refresh on 401
    │   │   │   ├── realtime-client.ts  # WebSocket subscription manager
    │   │   │   ├── auth-client.ts      # login / logout / register
    │   │   │   ├── query.ts            # React Query hooks
    │   │   │   ├── types.ts            # API response/request types
    │   │   │   ├── config.ts           # API base URL
    │   │   │   └── collection-slugs.ts # Resource path mappings
    │   │   ├── permissions.ts
    │   │   ├── hierarchy-id-generator.ts
    │   │   ├── team-workload.ts
    │   │   ├── project-health.ts
    │   │   ├── leave-utils.ts
    │   │   ├── attendance-utils.ts
    │   │   ├── notification-utils.ts
    │   │   ├── cache-utils.ts
    │   │   ├── ai-generator.ts
    │   │   └── utils.ts
    │   └── types/
    │       └── index.ts            # All TypeScript interfaces + enums
    ├── public/
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── playwright.config.ts
    └── next.config.js
```

---

## 3. Backend Architecture

### 3.1 Settings & Config

**Key settings in `config/settings/base.py`:**

| Setting | Value |
|---|---|
| Database | PostgreSQL @ localhost:5433 |
| Cache / Broker | Redis @ localhost:6379 |
| Auth | JWT in httpOnly cookies (`lt_access`, `lt_refresh`) |
| Access token TTL | 15 minutes |
| Refresh token TTL | 7 days (rotated on every refresh) |
| CORS allowed | `http://localhost:3000` |
| DRF renderer | CamelCase JSON |
| Default page size | 100 items |
| Storage | Local FS (switchable to S3 via `USE_S3=True`) |
| Email | Resend API |
| WebSocket | Channels + Redis layer |

**Installed Django apps:**
```
django.contrib.auth, contenttypes, sessions, messages, staticfiles
rest_framework, corsheaders, channels, daphne
simplejwt, storages
apps.core, accounts, workspaces, projects, tasks, sprints, epics,
requirements, leave, attendance, time_tracking, notifications,
activity, files, integrations, emails, realtime
```

---

### 3.2 API URL Structure

All routes are prefixed with `/api/v1/`.

```
/api/v1/
├── auth/
│   ├── login/              POST   → LoginView
│   ├── logout/             POST   → LogoutView (clears cookies, blacklists refresh)
│   ├── refresh/            POST   → RefreshView (silent token rotation)
│   ├── register/           POST   → RegisterView
│   ├── me/                 GET    → MeView (current user)
│   ├── change-password/    POST   → ChangePasswordView
│   ├── profile/            PATCH  → UpdateProfileView
│   ├── password-reset/     POST   → PasswordResetRequestView
│   └── password-reset/confirm/  POST  → PasswordResetConfirmView
│
├── users/                  GET    → Directory listing (workspace members)
│
├── workspaces/             CRUD   → WorkspaceViewSet
├── workspace_members/      CRUD   → WorkspaceMemberViewSet
├── workspace_roles/        CRUD   → WorkspaceRoleViewSet
├── invite_codes/           CRUD   → InviteCodeViewSet
├── email_invitations/      CRUD   → EmailInvitationViewSet
├── join_requests/          CRUD   → JoinRequestViewSet
├── pending_workspace_access/ CRUD → PendingWorkspaceAccessViewSet
│
├── projects/               CRUD   → ProjectViewSet
│
├── epics/                  CRUD   → EpicViewSet
├── sprints/                CRUD   → SprintViewSet
├── retrospectives/         CRUD   → RetrospectiveViewSet
│
├── requirements/
│   ├── client_requirements/       CRUD   → ClientRequirementViewSet
│   └── functional_requirements/   CRUD   → FunctionalRequirementViewSet
│
├── tasks/                  CRUD   → TaskViewSet
├── task_comments/          CRUD   → TaskCommentViewSet
├── kanban_columns/         CRUD   → KanbanColumnViewSet
├── labels/                 CRUD   → LabelViewSet
│
├── attendance/             CRUD   → AttendanceViewSet
├── holidays/               CRUD   → HolidayViewSet
├── leave_requests/         CRUD   → LeaveRequestViewSet
├── leave_balances/         GET/PATCH → LeaveBalanceViewSet
│
├── time_entries/           CRUD   → TimeEntryViewSet
├── active_timers/          CRUD   → ActiveTimerViewSet
│
├── notifications/          CRUD   → NotificationViewSet
├── activity_logs/          GET    → ActivityLogViewSet
├── saved_searches/         CRUD   → SavedSearchViewSet
│
├── files/                  CRUD   → UploadedFileViewSet
│
├── integrations/
│   ├── github/             CRUD   → GitHubIntegrationViewSet
│   ├── gitlab/             CRUD   → GitLabIntegrationViewSet
│   ├── discord/            CRUD   → DiscordIntegrationViewSet
│   └── git_commits/        GET    → GitCommitViewSet
│
├── emails/
│   ├── send-invitation/    POST
│   ├── send-leave/         POST
│   └── send-notification/  POST
│
└── bulk-save/              POST   → BulkSaveView (batch create/update)
```

**Common query parameters:**

| Param | Description |
|---|---|
| `workspaceId` | Filter by workspace |
| `projectId` | Filter by project |
| `sprintId` | Filter by sprint |
| `status` | Filter by status enum |
| `assigneeId` | Filter by assignee |
| `search` | Full-text search |
| `page` / `limit` | Pagination (default limit: 100) |

---

### 3.3 Django Models & Relationships

#### Accounts

**User**
```
id (CharField PK, 36 chars)   email (unique)         name
phone                          avatar (URL)           role
  → MANAGER | ASSISTANT_MANAGER | SOFTWARE_DEVELOPER
  → DEVELOPER_INTERN | TESTER | CONTENT_ENGINEER | MEMBER
workspace_id (default)         status (ACTIVE/INACTIVE)
has_temp_password              is_active, is_staff
created_at, updated_at
```

#### Workspaces

**Workspace**
```
id, name, description, logo, color
owner_id (FK → User)
invite_code (unique, auto-generated)
settings (JSONField)
```

**WorkspaceMember** — `unique(workspace, user)`
```
workspace_id (FK), user_id (FK)
role, status (ACTIVE | PENDING | INACTIVE)
joined_at
```

**WorkspaceRole** — `unique(workspace, name)`
```
workspace_id (FK), name
permissions (JSONField)
```

**InviteCode**
```
workspace_id (FK), code (unique)
role, max_uses, used_count, expires_at
created_by_id (FK → User)
```

**EmailInvitation**
```
workspace_id (FK), email
role, token (unique)
status (PENDING | ACCEPTED | EXPIRED | REVOKED)
expires_at, invited_by_id (FK → User)
```

**JoinRequest** — `unique(workspace, user)`
```
workspace_id (FK), user_id (FK)
message, status (PENDING | APPROVED | REJECTED)
handled_by_id (FK → User, nullable)
```

#### Projects & Epics

**Project**
```
id, workspace_id (FK), name, short_code
description, client_name, logo, color
methodology (SCRUM)
status (PLANNING | ACTIVE | ON_HOLD | COMPLETED | ARCHIVED)
archived, start_date, end_date
owner_id (FK), created_by_id (FK), created_by_name
member_ids (JSONField), project_settings (JSONField)
index: (workspace, status)
```

**Epic**
```
id, workspace_id, project_id (FK)
requirement_id (FK → ClientRequirement, optional)
hierarchy_id (e.g. "PTES-RAU-01")
name, description, color
start_date, end_date
status (TODO | IN_PROGRESS | DONE)
progress (0–100), assigned_team
created_by_id, created_by_name
```

**Sprint**
```
id, workspace_id, project_id (FK)
name, goal, start_date, end_date
status (PLANNING | ACTIVE | COMPLETED)
retrospective_notes
created_by_id, created_by_name
index: (project, status)
```

**Retrospective**
```
id, sprint_id (FK), workspace_id, project_id
went_well, needs_improvement
action_items (JSONField)
created_by_id
```

#### Requirements

**ClientRequirement**
```
id, workspace_id, project_id
title, description, client_name
priority (LOW | MEDIUM | HIGH | CRITICAL)
status (DRAFT | SUBMITTED | APPROVED | IN_PROGRESS | COMPLETED | ARCHIVED)
attachments (JSONField)
created_by_id, created_by_name
```

**FunctionalRequirement**
```
id, workspace_id, project_id
hierarchy_id (e.g. "PTES-RAU-EAU-FRL-01")
epic_id, sprint_id, client_requirement_id (optional)
title, description
complexity (LOW | MEDIUM | HIGH | VERY_HIGH)
priority, status (DRAFT | REVIEW | APPROVED | IMPLEMENTED | TESTED | DEPLOYED)
progress (0–100), reusable (bool)
assigned_to, assigned_to_names (JSONField)
tags, linked_project_ids
created_by_id, created_by_name
index: (project, epic_id), (hierarchy_id)
```

#### Tasks

**Task**
```
id, workspace_id, project_id
hierarchy_id (e.g. "PTES-RAU-EAU-FRL-01-LOG-01")
sprint_id, epic_id, functional_requirement_id (optional)
parent_task_id (FK → self, subtask support)
title, description
status (BACKLOG | TODO | IN_PROGRESS | REVIEW | DONE)
priority (LOW | MEDIUM | HIGH | CRITICAL)
assignee_ids, assigned_by, assigned_by_name
assigned_to, assigned_to_names (JSONField)
watcher_ids (JSONField)
due_date, estimated_hours, actual_hours
labels, attachments, custom_fields (JSONField)
position (float), blocked_by, blocks (JSONField)
created_by_id, created_by_name
index: (project, status), (sprint_id), (hierarchy_id)
```

**TaskComment**
```
id, task_id (FK), user_id (FK)
content (text), mentions, attachments (JSONField)
```

**KanbanColumn**
```
id, project_id (FK)
name, status (maps to TASK_STATUS enum)
wip_limit, position, color
```

**Label**
```
id, workspace_id, project_id (nullable, workspace-wide or project-scoped)
name, color, description
```

#### HR Models

**Attendance** — `unique(workspace, user, date)`, index: `(workspace, date)`
```
id, workspace_id, user_id
date, check_in_time, check_out_time (nullable)
work_hours (float)
status (PRESENT | LATE | EARLY_LEAVE | ABSENT | LEAVE | HALF_DAY)
late_minutes, location, notes
is_weekend, is_holiday
created_by_id, created_by_name
```

**Holiday** — `unique(workspace, date, name)`
```
id, workspace_id, name, date
is_optional, description
```

**LeaveRequest**
```
id, workspace_id, user_id
created_by_id, created_by_name
type (PAID | UNPAID | CASUAL | SICK | ANNUAL | MATERNITY | PATERNITY | BEREAVEMENT | HALF_DAY | COMP_OFF)
start_date, end_date, reason
status (PENDING | APPROVED | REJECTED | CANCELLED)
approved_by, approved_at, rejection_reason
days_count (float)
```

**LeaveBalance** — `unique(workspace, user, year)`
```
id, workspace_id, user_id, year
paid_leave, unpaid_leave, half_day, comp_off (float)
```

#### Time Tracking

**TimeEntry** — index: `(workspace, user, -start_time)`, `(task_id)`
```
id, workspace_id, user_id, user_name, user_email
created_by_id, created_by_name
task_id, task_title, task_hierarchy_id, project_id, project_name
description, start_time, end_time, duration (minutes)
is_billable, billable_rate (float)
type (MANUAL | TIMER | POMODORO)
status (PENDING | APPROVED | REJECTED)
approved_by, approved_at, rejection_reason
tags (JSONField)
```

**ActiveTimer** — OneToOne with User
```
id, user_id (OneToOne)
task_id, task_title, task_hierarchy_id, project_id
description, start_time
is_paused, paused_at, total_paused_time (minutes)
type (TIMER | POMODORO), pomodoro_settings (JSONField)
```

#### Notifications & Activity

**Notification** — index: `(user, is_read)`, `(workspace, -created_at)`
```
id, workspace_id, user_id
type, title, message
project_id, related_entity_id, related_entity_type
is_read (bool)
```

**ActivityLog** — index: `(workspace, -created_at)`, `(entity_type, entity_id)`
```
id, workspace_id, user_id
action, entity_type, entity_id
changes, metadata (JSONField)
```

**SavedSearch**
```
id, workspace_id, user_id
name, query, filters (JSONField)
```

#### Files & Integrations

**UploadedFile**
```
id, name, file (FileField)
mime_type, size (BigInteger)
workspace_id, project_id
uploaded_by_id (FK), bucket
```

**GitHubIntegration** — OneToOne with Project
```
project_id, repo_owner, repo_name
access_token (encrypted), webhook_secret
auto_update_status, enabled_events (JSONField)
```

**GitLabIntegration** — OneToOne with Project
```
project_id, project_path, access_token
webhook_secret, auto_update_status, enabled_events (JSONField)
```

**DiscordIntegration** — OneToOne with Project
```
project_id, webhook_url, enabled_events (JSONField)
```

**GitCommit** — `unique(project, commit_sha)`
```
id, project_id (FK)
provider (GITHUB | GITLAB)
commit_sha, message, author, author_email, timestamp, url
linked_task_ids (JSONField)
```

#### Entity Relationship Summary

```
Workspace
  ├── WorkspaceMember → User
  ├── WorkspaceRole
  ├── InviteCode / EmailInvitation / JoinRequest
  └── Project
        ├── Sprint
        │     └── Task (sprint_id)
        ├── Epic
        │     └── Task (epic_id)
        ├── ClientRequirement
        │     └── FunctionalRequirement
        │           └── Task (functional_requirement_id)
        ├── Task (all tasks)
        │     ├── TaskComment
        │     ├── KanbanColumn
        │     └── Task (parent_task_id — subtasks)
        ├── Retrospective (via Sprint)
        ├── GitHubIntegration / GitLabIntegration / DiscordIntegration / GitCommit
        └── UploadedFile

User
  ├── Attendance
  ├── LeaveRequest / LeaveBalance
  ├── TimeEntry / ActiveTimer
  ├── Notification
  └── ActivityLog
```

---

## 4. Frontend Architecture

### 4.1 App Router Layout

```
Root layout (layout.tsx)
  └── ThemeProvider (next-themes)
        └── QueryProvider (TanStack React Query)
              └── AuthProvider (JWT state)
                    ├── Toaster
                    └── (auth)/ pages
                        (dashboard)/
                          └── layout.tsx
                                ├── WorkspaceGuard     ← redirects to onboarding if no workspace
                                ├── WorkspaceProvider  ← current workspace + member list context
                                ├── Sidebar
                                ├── Header             ← breadcrumbs, user menu, notifications
                                ├── CommandPalette     ← global Cmd+K search
                                ├── DeadlineReminderChecker  ← background notification checker
                                └── <page content>
```

### 4.2 Page Routes

| Route | Purpose |
|---|---|
| `/login` | Login form |
| `/change-password` | Force password change (temp password flow) |
| `/onboarding` | First-time workspace creation wizard |
| `/dashboard` | Main dashboard with KPIs |
| `/profile` | User profile settings |
| `/workspaces` | Workspace switcher and management |
| `/settings` | Workspace settings (name, roles, integrations) |
| `/projects` | Project list |
| `/projects/[projectId]` | Project overview |
| `/projects/[projectId]/settings` | Project settings (members, integrations) |
| `/sprints` | Sprint list for current project |
| `/sprints/[id]/board` | Sprint kanban board |
| `/sprints/[id]/backlog` | Sprint backlog management |
| `/sprints/[id]/analytics` | Burndown chart + velocity |
| `/tasks` | Flat task list view |
| `/epics` | Epic list |
| `/requirements` | Client requirements list |
| `/functional-requirements` | Functional requirements tree |
| `/attendance` | Personal check-in / check-out |
| `/attendance/team` | Team attendance analytics |
| `/leave` | Leave request + approval |
| `/calendar` | Event / availability calendar |
| `/team` | Team members, roles, resource allocation |
| `/analytics` | Workspace KPI dashboard |
| `/analytics/team` | Team workload and capacity |
| `/analytics/workspace` | Workspace-wide analytics |
| `/activity` | Activity feed and audit log |

### 4.3 Components

#### UI Primitives (`components/ui/`)
Radix UI based: Button, Input, Textarea, Select, Dialog, Form, Table, Tabs, Card, Alert, Badge, Progress, Avatar, Toast, Popover, DropdownMenu, Tooltip, DatePicker, Calendar, Radio, Checkbox, ScrollArea, Separator, Switch, Command.

#### Feature Components

**Tasks**
- `CreateTaskDialog` — new task form with assignee picker, FR linkage
- `EditTaskDialog` — inline edit with status, priority, sprint reassignment
- `TaskDetailsDialog` — full task view with comments, time entries, watchers
- `TaskBoard` — Kanban columns with drag-and-drop
- `TaskDependencies` — blocked_by / blocks management

**Projects**
- `CreateProjectDialog` / `EditProjectDialog` / `CloneProjectDialog`
- `ProjectHealthBadge` / `ProjectHealthCard` — health score visualization
- `MethodologySelector`

**Sprints**
- `CreateSprintDialog`
- `SprintBoard` — sprint-scoped kanban
- `BurndownChart` — sprint progress (Recharts)
- `FRAssignmentCard` — assign FRs to sprint

**Requirements**
- `CreateClientRequirementDialog` / `ClientRequirementDetailDialog`
- `CreateFunctionalRequirementDialog` / `FunctionalRequirementDetailDialog`

**Epics**
- `CreateEpicDialog` / `EpicDetailDialog`

**Leave & Attendance**
- `LeaveRequestForm` — submit leave with type, dates, reason
- `LeaveBalanceDisplay` — remaining balance per type
- `LeaveApprovalCard` — approve / reject with reason
- `AttendanceCalendar` — monthly calendar view
- `AttendanceStats` — % attendance, late count
- `AttendanceWidget` — quick status in header
- `TeamAttendanceTab` — team-level analytics

**Time Tracking**
- `TaskTimeTracking` — start/pause/stop timer on a task
- `ManualTimeEntryDialog` — log time retroactively

**Team & Workspace**
- `AddMembersSection` / `DeleteMemberDialog`
- `ResourceAllocationCard` — capacity/workload per member
- `WorkspaceSwitcher` / `InviteMemberDialog` / `DeleteWorkspaceDialog`

**Notifications & Search**
- `NotificationCenter` — bell icon + notification list
- `DeadlineReminderChecker` — background component, polls due dates
- `CommandPalette` — Cmd+K global search across all resources
- `SearchHighlight` / `SearchHistory`

**Analytics**
- `KPIWidgets` — task velocity, completion rate, resource utilization

**AI**
- `AIGenerateDialog` — uses Google Generative AI to draft task descriptions

### 4.4 Providers & Context

| Provider | Location | Provides |
|---|---|---|
| `ThemeProvider` | root layout | dark / light mode |
| `QueryProvider` | root layout | React Query client + WebSocket realtime cache invalidation |
| `AuthProvider` | root layout | `user`, `login()`, `logout()`, `isLoading` |
| `WorkspaceProvider` | dashboard layout | `currentWorkspace`, `members`, `switchWorkspace()` |

### 4.5 Utilities & Hooks

| Utility | Purpose |
|---|---|
| `rest-client.ts` | Fetch wrapper: sends cookies, retries once on 401 after token refresh |
| `realtime-client.ts` | WebSocket manager: connect, subscribe to collections, auto-reconnect |
| `auth-client.ts` | `login()`, `logout()`, `register()` wrappers |
| `query.ts` | TanStack Query hooks for all resources |
| `permissions.ts` | Role-based access checks (`canEdit`, `canDelete`, etc.) |
| `hierarchy-id-generator.ts` | Generates deterministic IDs like `PTES-RAU-EAU-FRL-01` |
| `team-workload.ts` | Capacity and workload calculations per member |
| `project-health.ts` | Computes project health score (0–100) |
| `leave-utils.ts` | Leave balance math, days calculation |
| `attendance-utils.ts` | Status logic (LATE, EARLY_LEAVE, etc.) |
| `notification-utils.ts` | Notification formatting helpers |
| `cache-utils.ts` | React Query cache invalidation strategies |
| `ai-generator.ts` | Google Generative AI client for task generation |
| `csv-parser.ts` | CSV import for bulk task/requirement upload |
| `query-keys.ts` | Centralized TanStack Query key factories |
| `utils.ts` | `cn()` (clsx), date formatting, misc helpers |

---

## 5. Authentication Flow

### Login

```
Browser                          Next.js                    Django
  │                                │                           │
  ├─ POST /api/v1/auth/login/ ─────────────────────────────→  │
  │  { email, password }           │                           │
  │                                │                 Validates credentials
  │                                │                 Generates JWT pair
  │ ←─ Set-Cookie: lt_access ─────────────────────────────── │
  │    Set-Cookie: lt_refresh      │                           │
  │    { user: {...} }             │                           │
  │                                │                           │
  └─ AuthProvider stores user ──→ React state                 │
```

**Cookie config:**
- `lt_access` — httpOnly, Secure, SameSite=Lax, 15 min TTL
- `lt_refresh` — httpOnly, Secure, SameSite=Lax, 7 day TTL

### Silent Token Refresh

```
Browser                       rest-client.ts              Django
  │                               │                          │
  ├─ API request ──────────────→  │                          │
  │                               ├─ fetch(resource) ──────→ │
  │                               │ ←─ 401 Unauthorized ──── │
  │                               │                          │
  │                               ├─ POST /auth/refresh/ ──→ │
  │                               │ ←─ new lt_access cookie ─│
  │                               │                          │
  │                               ├─ Retry original request ─│
  │ ←─ 200 OK ────────────────── │ ←─ 200 OK ────────────── │
```

### Middleware Chain (Backend)

```
Request → CORS → JWTCookieMiddleware → (cookie → Authorization header) → DRF JWT auth → View
```

---

## 6. Real-Time Architecture

### WebSocket Connection

```
Frontend (realtime-client.ts)          Django Channels            Redis
  │                                         │                       │
  ├─ WS /ws/collections/ ────────────────→  │                       │
  │  [JWT cookie sent automatically]        │ JWTCookieAuthMiddleware│
  │                                         │ → CollectionConsumer  │
  │ { action: "subscribe",                  │                       │
  │   channels: ["tasks", "sprints"] } ──→  │ Join group:           │
  │                                         │ rt_tasks, rt_sprints  │
  │                                         │ ────────────────────→ │
  │                                         │                       │
  │    (anywhere in the system)             │                       │
  │    Task.save() triggers signal ─────────→ CollectionConsumer    │
  │                                         │ ←─ Redis pub/sub ──── │
  │ ←─ { event: "tasks.updated",           │                       │
  │       payload: { id, ...fields } } ─── │                       │
  │                                         │                       │
  └─ QueryProvider invalidates             │                       │
     React Query cache for "tasks"         │                       │
```

### Collections & Groups

Every model declares `REALTIME_COLLECTION`. A Django post-save signal reads this and broadcasts to the matching Redis group (`rt_<collection>`).

| Collection | Triggered by |
|---|---|
| `workspaces` | Workspace save |
| `workspace_members` | WorkspaceMember save |
| `projects` | Project save |
| `tasks` | Task save |
| `task_comments` | TaskComment save |
| `sprints` | Sprint save |
| `epics` | Epic save |
| `functional_requirements` | FunctionalRequirement save |
| `client_requirements` | ClientRequirement save |
| `leave_requests` | LeaveRequest save |
| `attendance` | Attendance save |
| `time_entries` | TimeEntry save |
| `notifications` | Notification save |
| `activity_logs` | ActivityLog save |
| `files` | UploadedFile save |
| `git_commits` | GitCommit save |

---

## 7. User Flows

### 7.1 Onboarding

```
1. User registers → POST /auth/register/
2. Login → receives JWT cookies
3. No workspace detected → WorkspaceGuard redirects to /onboarding
4. Onboarding wizard:
   a. Create workspace (name, logo, color)
   b. Invite team members (email invitations or invite code)
   c. Create first project
5. Redirect to /dashboard
```

### 7.2 Project & Sprint Lifecycle

```
Project created (PLANNING)
  │
  ├─ Add members to project (subset of workspace members)
  ├─ Create Client Requirements
  ├─ Decompose into Functional Requirements (with hierarchy IDs)
  ├─ Group into Epics
  │
  ▼
Project ACTIVE
  │
  ├─ Sprint 1 created (PLANNING)
  │     ├─ Assign FRs to sprint
  │     ├─ Assign tasks to sprint from backlog
  │     ├─ Sprint ACTIVE → board unlocked
  │     ├─ Daily: move tasks on kanban (BACKLOG→TODO→IN_PROGRESS→REVIEW→DONE)
  │     ├─ Burndown chart updates in real time
  │     └─ Sprint COMPLETED
  │           └─ Retrospective created (went_well, needs_improvement, action_items)
  │
  ├─ Sprint 2, 3... (repeat)
  │
  └─ Project COMPLETED / ARCHIVED
```

### 7.3 Requirement Hierarchy

```
ClientRequirement         (what the customer wants)
  │   e.g. "User Authentication System"
  │
  └── FunctionalRequirement  (technical spec, hierarchy ID: PTES-RAU-01-FRL-01)
        │   e.g. "Implement JWT-based login endpoint"
        │
        └── Epic              (large deliverable chunk)
              │   e.g. "Auth Epic"
              │
              └── Task         (single implementable unit, hierarchy ID: PTES-RAU-01-FRL-01-LOG-01)
                    │   e.g. "Create login API view"
                    │
                    └── Task   (subtask, parent_task_id set)
                          e.g. "Write unit tests for login view"
```

**Hierarchy ID generation** (`hierarchy-id-generator.ts`):
- Encodes workspace + project + parent context into a short alphanumeric code
- Ensures uniqueness and traceability across the full hierarchy

### 7.4 Leave Management

```
Employee                    System                      Manager
  │                           │                            │
  ├─ Submit LeaveRequest ────→│ status=PENDING             │
  │  (type, dates, reason)    │ Notify manager ───────────→│
  │                           │                            │
  │                           │                    ├─ View leave request
  │                           │                    ├─ Approve → status=APPROVED
  │                           │                    │   ├─ Deduct from LeaveBalance
  │                           │                    │   ├─ Auto-mark Attendance as LEAVE
  │                           │                    │   └─ Send email notification
  │                           │                    │
  │                           │                    └─ Reject → status=REJECTED
  │ ←─ Notification ─────────│←── Update event ───────────│
  │    + Email                │   (WebSocket)              │
```

**Leave types:** PAID, UNPAID, CASUAL, SICK, ANNUAL, MATERNITY, PATERNITY, BEREAVEMENT, HALF_DAY, COMP_OFF

### 7.5 Attendance & Time Tracking

**Daily Attendance Flow:**
```
Employee arrives
  │
  ├─ Check-in → POST /attendance/ { check_in_time: now }
  │   Status computed:
  │   ├─ On time    → PRESENT
  │   ├─ After 9:30 → LATE
  │   └─ Weekend    → is_weekend = True
  │
  │ (work happens)
  │
  └─ Check-out → PATCH /attendance/{id}/ { check_out_time: now }
      work_hours = check_out - check_in - breaks
```

**Time Tracking Flow:**
```
On a Task:
  ├─ Manual entry → POST /time_entries/ { start_time, end_time, duration }
  ├─ Timer        → POST /active_timers/ → start
  │                 PATCH /active_timers/{id}/ { is_paused: true } → pause
  │                 PATCH /active_timers/{id}/ { is_paused: false } → resume
  │                 DELETE /active_timers/{id}/ → stop + create TimeEntry
  └─ Pomodoro     → Same as Timer but with pomodoro_settings (25/5 min cycles)

Manager can approve/reject TimeEntry → status: APPROVED | REJECTED
```

---

## 8. Permission System

### Backend

| Class | Rule |
|---|---|
| `IsAuthenticated` | Valid JWT required |
| `IsWorkspaceMember` | User must be member of the target workspace |
| `IsOwnerOrReadOnly` | Only the creator can modify (others read-only) |

**Role hierarchy:**
```
MANAGER > ASSISTANT_MANAGER > SOFTWARE_DEVELOPER > TESTER > CONTENT_ENGINEER > DEVELOPER_INTERN > MEMBER
```

### Frontend (`permissions.ts`)

Provides helper functions like:
- `canManageMembers(user, workspace)` — MANAGER only
- `canApproveLeave(user)` — MANAGER or ASSISTANT_MANAGER
- `canEditProject(user, project)` — owner or MANAGER
- `canDeleteWorkspace(user, workspace)` — owner only
- `canCreateFR(user, workspace)` — checks specific FR permission
- `canCreateRequirement(user, workspace)` — checks requirement permission

Components conditionally render actions (buttons, menus) based on these checks.

---

## 9. Infrastructure & Deployment

### Docker Compose Services

```yaml
services:
  postgres:
    image: postgres:16
    ports: ["5433:5432"]

  redis:
    image: redis:7
    ports: ["6379:6379"]

  web:
    build: ./backend
    command: daphne config.asgi:application -b 0.0.0.0 -p 8000
    depends_on: [postgres, redis]
    ports: ["8000:8000"]

  worker:
    build: ./backend
    command: celery -A config.celery worker --loglevel=info
    depends_on: [postgres, redis]

  beat:
    build: ./backend
    command: celery -A config.celery beat --loglevel=info
    depends_on: [postgres, redis]
```

### Local Development

```bash
# Backend
cd backend
docker-compose up -d postgres redis
python manage.py migrate
daphne config.asgi:application        # or: python manage.py runserver

# Frontend
cd frontend
npm install
npm run dev                            # http://localhost:3000
```

### Environment Variables

**Backend `.env`:**
```
DJANGO_SETTINGS_MODULE=config.settings.dev
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/ltconnect
REDIS_URL=redis://localhost:6379/0
FRONTEND_URL=http://localhost:3000
CORS_ALLOWED_ORIGINS=http://localhost:3000
USE_S3=False
RESEND_API_KEY=<your-key>
EMAIL_FROM=noreply@example.com
```

**Frontend `.env.local`:**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Celery Tasks (Background)

- **Email notifications** — triggered on leave approval, task assignment, deadline
- **Attendance reminders** — scheduled daily (Celery Beat)
- **Deadline checks** — scans tasks due soon, emits notifications
- **Token cleanup** — removes expired JWT refresh tokens from blacklist

---

## 10. Data Flow Diagram

```
Browser (Next.js)
     │
     │  REST (credentials: include → httpOnly JWT cookies)
     │  WebSocket /ws/collections/
     │
     ▼
Daphne (ASGI — port 8000)
     │
     ├── HTTP requests → DRF ViewSets → PostgreSQL (port 5433)
     │                                       ↑
     │                               ORM queries
     │
     ├── WebSocket → Django Channels → CollectionConsumer
     │                                       │
     │                               Redis Channel Layer
     │                                       │
     │                   ←─── pub/sub ───────┘
     │                   push event to subscribed clients
     │
     └── Signal handlers → (post_save) → Redis broadcast
                                    → Notification create
                                    → ActivityLog create

Background (Celery)
     │
     ├── Worker: email sends (Resend API), webhooks (Discord)
     └── Beat:   scheduled jobs (reminders, cleanup)
```

---

*Generated from deep static analysis of the L-T-Connect-2 codebase — June 2026.*
