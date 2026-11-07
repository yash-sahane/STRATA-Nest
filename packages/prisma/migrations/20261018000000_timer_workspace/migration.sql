-- A running timer records the workspace it was started for.
--
-- It had none. Stopping one filed the entry in whatever workspace the browser
-- named at that moment, so a timer started on a task in one workspace and
-- stopped after switching to another put that task's hours in front of the
-- wrong approvers, and the task's own workspace never saw them. Without a
-- workspace its realtime frame could not be scoped either, and went to every
-- connected user.
--
-- '' for a timer already running when this lands: it is filed where it is
-- stopped, as before.

ALTER TABLE "time_tracking_activetimer"
  ADD COLUMN IF NOT EXISTS "workspace_id" TEXT NOT NULL DEFAULT '';
