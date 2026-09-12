-- PendingWorkspaceAccess: one pending request per (workspace, user), mirroring
-- the constraint JoinRequest has carried since the baseline. PendingAccessService
-- now upserts on this pair instead of appending a row on every submit.
--
-- DEFENSIVE: the table had no such constraint, so existing rows may already hold
-- duplicates. Collapse them first — keep the most recently created row for each
-- pair (ties broken by id) and drop the rest — otherwise CREATE UNIQUE INDEX
-- fails and the whole migration aborts. The dropped rows are superseded
-- duplicates of the surviving one; no request is lost.

-- Deduplicate
DELETE FROM "workspaces_pendingworkspaceaccess" AS "older"
USING "workspaces_pendingworkspaceaccess" AS "newer"
WHERE "older"."workspace_id" = "newer"."workspace_id"
  AND "older"."user_id" = "newer"."user_id"
  AND ("older"."created_at" < "newer"."created_at"
       OR ("older"."created_at" = "newer"."created_at" AND "older"."id" < "newer"."id"));

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_pendingworkspaceaccess_workspace_id_user_id_key" ON "workspaces_pendingworkspaceaccess"("workspace_id", "user_id");
