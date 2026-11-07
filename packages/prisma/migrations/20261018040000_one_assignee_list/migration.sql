-- One assignee list. A task's people were held three times (assignee_ids, a
-- mirrored assigned_to, and assigned_to_names); a functional requirement called
-- the same list assigned_to. Both now hold assignee_ids + assignee_names.
UPDATE "tasks_task" SET "assignee_ids" = "assigned_to"
  WHERE "assignee_ids" = '[]'::jsonb AND "assigned_to" <> '[]'::jsonb;
ALTER TABLE "tasks_task" DROP COLUMN "assigned_to";
ALTER TABLE "tasks_task" RENAME COLUMN "assigned_to_names" TO "assignee_names";
ALTER TABLE "requirements_functionalrequirement" RENAME COLUMN "assigned_to" TO "assignee_ids";
ALTER TABLE "requirements_functionalrequirement" RENAME COLUMN "assigned_to_names" TO "assignee_names";

-- Columns nothing shows and nothing decides anything by.
ALTER TABLE "tasks_task"
  DROP COLUMN "watcher_ids",
  DROP COLUMN "custom_fields",
  DROP COLUMN "actual_hours";
ALTER TABLE "epics_epic" DROP COLUMN "assigned_team";
ALTER TABLE "requirements_functionalrequirement"
  DROP COLUMN "tags",
  DROP COLUMN "linked_project_ids",
  DROP COLUMN "reusable";
ALTER TABLE "time_tracking_activetimer"
  DROP COLUMN "type",
  DROP COLUMN "pomodoro_settings";
ALTER TABLE "time_tracking_timeentry"
  DROP COLUMN "type",
  DROP COLUMN "billable_rate";
ALTER TABLE "accounts_user"
  DROP COLUMN "last_login",
  DROP COLUMN "is_staff";
ALTER TABLE "projects_project"
  DROP COLUMN "methodology",
  DROP COLUMN "project_settings",
  DROP COLUMN "member_ids",
  DROP COLUMN "logo",
  DROP COLUMN "color";
ALTER TABLE "workspaces_workspace"
  DROP COLUMN "logo",
  DROP COLUMN "color";

-- Written on every notification, read by nothing.
DROP TABLE "notifications_notificationdelivery";

-- The normalised RBAC tables were never queried: permissions resolve from the
-- built-in map in code plus workspace_roles.permissions (ADR-0005, as built).
DROP TABLE "authz_user_permission";
DROP TABLE "authz_role_permission";
DROP TABLE "authz_permission";
