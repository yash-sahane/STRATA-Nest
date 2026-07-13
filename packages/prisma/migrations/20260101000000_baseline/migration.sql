-- CreateTable
CREATE TABLE "activity_activitylog" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "activity_activitylog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_savedsearch" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "activity_savedsearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authz_permission" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "authz_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authz_role_permission" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "role" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "authz_role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authz_user_permission" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "permission_id" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "authz_user_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files_uploadedfile" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT '',
    "size" BIGINT NOT NULL DEFAULT 0,
    "workspace_id" TEXT NOT NULL DEFAULT '',
    "project_id" TEXT NOT NULL DEFAULT '',
    "uploaded_by_id" TEXT,
    "bucket" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "files_uploadedfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_idempotencykey" (
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_idempotencykey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "attendance_attendance" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "check_in_time" TIMESTAMP(3) NOT NULL,
    "check_out_time" TIMESTAMP(3),
    "work_hours" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "is_weekend" BOOLEAN NOT NULL DEFAULT false,
    "is_holiday" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_by_name" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "attendance_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_holiday" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "attendance_holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_leaverequest" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" TEXT NOT NULL DEFAULT '',
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT NOT NULL DEFAULT '',
    "days_count" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "leave_leaverequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_leavebalance" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "paid_leave" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unpaid_leave" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "half_day" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comp_off" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "leave_leavebalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_user" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "password" TEXT NOT NULL,
    "last_login" TIMESTAMP(3),
    "is_superuser" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "avatar" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "workspace_id" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "has_temp_password" BOOLEAN NOT NULL DEFAULT false,
    "is_admin_flag" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "accounts_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations_githubintegration" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" TEXT NOT NULL,
    "repo_owner" TEXT NOT NULL,
    "repo_name" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL DEFAULT '',
    "auto_update_status" BOOLEAN NOT NULL DEFAULT false,
    "enabled_events" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "integrations_githubintegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations_gitlabintegration" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_path" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL DEFAULT '',
    "auto_update_status" BOOLEAN NOT NULL DEFAULT false,
    "enabled_events" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "integrations_gitlabintegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations_discordintegration" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" TEXT NOT NULL,
    "webhook_url" TEXT NOT NULL,
    "enabled_events" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "integrations_discordintegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations_gitcommit" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "linked_task_ids" JSONB NOT NULL DEFAULT '[]',
    "url" TEXT NOT NULL,

    CONSTRAINT "integrations_gitcommit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications_notification" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "project_id" TEXT NOT NULL DEFAULT '',
    "related_entity_id" TEXT NOT NULL DEFAULT '',
    "related_entity_type" TEXT NOT NULL DEFAULT '',
    "is_read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notifications_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications_notificationdelivery" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "delivered_at" TIMESTAMP(3),
    "error" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "notifications_notificationdelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epics_epic" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL DEFAULT '',
    "hierarchy_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "start_date" DATE,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "assigned_team" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "epics_epic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints_sprint" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "retrospective_notes" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "sprints_sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints_retrospective" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sprint_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "went_well" JSONB NOT NULL DEFAULT '[]',
    "needs_improvement" JSONB NOT NULL DEFAULT '[]',
    "action_items" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "sprints_retrospective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects_project" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "client_name" TEXT NOT NULL DEFAULT '',
    "logo" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "methodology" TEXT NOT NULL DEFAULT 'SCRUM',
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "start_date" DATE,
    "end_date" DATE,
    "owner_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',
    "member_ids" JSONB NOT NULL DEFAULT '[]',
    "project_settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "projects_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements_clientrequirement" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "client_name" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "requirements_clientrequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements_functionalrequirement" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "hierarchy_id" TEXT NOT NULL,
    "epic_id" TEXT NOT NULL DEFAULT '',
    "sprint_id" TEXT NOT NULL DEFAULT '',
    "client_requirement_id" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "complexity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "priority" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "assigned_to" JSONB NOT NULL DEFAULT '[]',
    "assigned_to_names" JSONB NOT NULL DEFAULT '[]',
    "tags" TEXT NOT NULL DEFAULT '',
    "linked_project_ids" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "requirements_functionalrequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks_task" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "hierarchy_id" TEXT NOT NULL,
    "sprint_id" TEXT NOT NULL DEFAULT '',
    "epic_id" TEXT NOT NULL DEFAULT '',
    "functional_requirement_id" TEXT NOT NULL DEFAULT '',
    "parent_task_id" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'BACKLOG',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignee_ids" JSONB NOT NULL DEFAULT '[]',
    "assigned_by" TEXT NOT NULL DEFAULT '',
    "assigned_by_name" TEXT NOT NULL DEFAULT '',
    "assigned_to" JSONB NOT NULL DEFAULT '[]',
    "assigned_to_names" JSONB NOT NULL DEFAULT '[]',
    "watcher_ids" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',
    "due_date" TIMESTAMP(3),
    "estimated_hours" DOUBLE PRECISION,
    "actual_hours" DOUBLE PRECISION,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blocked_by" JSONB NOT NULL DEFAULT '[]',
    "blocks" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "tasks_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks_taskcomment" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "attachments" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "tasks_taskcomment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks_kanbancolumn" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "wip_limit" INTEGER,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "tasks_kanbancolumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks_label" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "tasks_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_tracking_timeentry" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL DEFAULT '',
    "task_id" TEXT NOT NULL DEFAULT '',
    "task_title" TEXT NOT NULL DEFAULT '',
    "task_hierarchy_id" TEXT NOT NULL DEFAULT '',
    "project_id" TEXT NOT NULL DEFAULT '',
    "project_name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "is_billable" BOOLEAN NOT NULL DEFAULT false,
    "billable_rate" DOUBLE PRECISION,
    "type" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" TEXT NOT NULL DEFAULT '',
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "time_tracking_timeentry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_tracking_activetimer" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL DEFAULT '',
    "task_title" TEXT NOT NULL DEFAULT '',
    "task_hierarchy_id" TEXT NOT NULL DEFAULT '',
    "project_id" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "start_time" TIMESTAMP(3) NOT NULL,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_at" TIMESTAMP(3),
    "total_paused_time" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'TIMER',
    "pomodoro_settings" JSONB,

    CONSTRAINT "time_tracking_activetimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces_workspace" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "logo" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "owner_id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "workspaces_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces_workspacemember" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_workspacemember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces_workspacerole" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "workspaces_workspacerole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces_invitecode" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "workspaces_invitecode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces_emailinvitation" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invited_by_id" TEXT NOT NULL,

    CONSTRAINT "workspaces_emailinvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces_joinrequest" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "handled_by_id" TEXT,

    CONSTRAINT "workspaces_joinrequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces_pendingworkspaceaccess" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_role" TEXT NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "workspaces_pendingworkspaceaccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_activitylog_workspace_id_created_at_idx" ON "activity_activitylog"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_activitylog_entity_type_entity_id_idx" ON "activity_activitylog"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "authz_permission_key_key" ON "authz_permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "authz_role_permission_workspace_id_role_permission_id_key" ON "authz_role_permission"("workspace_id", "role", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "authz_user_permission_user_id_workspace_id_permission_id_key" ON "authz_user_permission"("user_id", "workspace_id", "permission_id");

-- CreateIndex
CREATE INDEX "files_uploadedfile_workspace_id_idx" ON "files_uploadedfile"("workspace_id");

-- CreateIndex
CREATE INDEX "files_uploadedfile_project_id_idx" ON "files_uploadedfile"("project_id");

-- CreateIndex
CREATE INDEX "attendance_attendance_workspace_id_date_idx" ON "attendance_attendance"("workspace_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_attendance_workspace_id_user_id_date_key" ON "attendance_attendance"("workspace_id", "user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_holiday_workspace_id_date_name_key" ON "attendance_holiday"("workspace_id", "date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_leavebalance_workspace_id_user_id_year_key" ON "leave_leavebalance"("workspace_id", "user_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_email_key" ON "accounts_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_githubintegration_project_id_key" ON "integrations_githubintegration"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_gitlabintegration_project_id_key" ON "integrations_gitlabintegration"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_discordintegration_project_id_key" ON "integrations_discordintegration"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_gitcommit_project_id_commit_sha_key" ON "integrations_gitcommit"("project_id", "commit_sha");

-- CreateIndex
CREATE INDEX "notifications_notification_user_id_is_read_idx" ON "notifications_notification"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_notification_workspace_id_created_at_idx" ON "notifications_notification"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_notificationdelivery_notification_id_idx" ON "notifications_notificationdelivery"("notification_id");

-- CreateIndex
CREATE INDEX "notifications_notificationdelivery_status_channel_idx" ON "notifications_notificationdelivery"("status", "channel");

-- CreateIndex
CREATE INDEX "sprints_sprint_project_id_status_idx" ON "sprints_sprint"("project_id", "status");

-- CreateIndex
CREATE INDEX "projects_project_workspace_id_status_idx" ON "projects_project"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "requirements_functionalrequirement_project_id_epic_id_idx" ON "requirements_functionalrequirement"("project_id", "epic_id");

-- CreateIndex
CREATE INDEX "requirements_functionalrequirement_hierarchy_id_idx" ON "requirements_functionalrequirement"("hierarchy_id");

-- CreateIndex
CREATE INDEX "tasks_task_project_id_status_idx" ON "tasks_task"("project_id", "status");

-- CreateIndex
CREATE INDEX "tasks_task_sprint_id_idx" ON "tasks_task"("sprint_id");

-- CreateIndex
CREATE INDEX "tasks_task_hierarchy_id_idx" ON "tasks_task"("hierarchy_id");

-- CreateIndex
CREATE INDEX "time_tracking_timeentry_workspace_id_user_id_start_time_idx" ON "time_tracking_timeentry"("workspace_id", "user_id", "start_time");

-- CreateIndex
CREATE INDEX "time_tracking_timeentry_task_id_idx" ON "time_tracking_timeentry"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "time_tracking_activetimer_user_id_key" ON "time_tracking_activetimer"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_workspace_invite_code_key" ON "workspaces_workspace"("invite_code");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_workspacemember_workspace_id_user_id_key" ON "workspaces_workspacemember"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_workspacerole_workspace_id_name_key" ON "workspaces_workspacerole"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_invitecode_code_key" ON "workspaces_invitecode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_emailinvitation_token_key" ON "workspaces_emailinvitation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_joinrequest_workspace_id_user_id_key" ON "workspaces_joinrequest"("workspace_id", "user_id");

-- AddForeignKey
ALTER TABLE "authz_role_permission" ADD CONSTRAINT "authz_role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "authz_permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authz_user_permission" ADD CONSTRAINT "authz_user_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "authz_permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

