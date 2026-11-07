-- Asking the server instead of downloading every task: whose tasks they are,
-- what is due, and what was finished when.
CREATE INDEX "tasks_task_assignee_ids_idx" ON "tasks_task" USING GIN ("assignee_ids" jsonb_path_ops);
CREATE INDEX "tasks_task_workspace_id_due_date_idx" ON "tasks_task"("workspace_id", "due_date");
CREATE INDEX "tasks_task_workspace_id_completed_at_idx" ON "tasks_task"("workspace_id", "completed_at");
