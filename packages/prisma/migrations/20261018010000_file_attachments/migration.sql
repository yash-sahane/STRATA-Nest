-- Files attach to a task or a client requirement.
--
-- A file belonged to a project and nothing else, so a screenshot for a bug, the
-- client's signed-off brief or a log for a failing build could only be put in
-- the project's one long list, with nothing to say what it was for. A file now
-- names the task or client requirement it is attached to ('' for neither: the
-- project's own files). Deleting that task or requirement hands the file back
-- to the project; deleting the project still deletes it.
--
-- Tasks, task comments and client requirements each carried an `attachments`
-- JSON list meant for this. Nothing in the product ever wrote to one (every
-- create stored []), and a second way of attaching would be a second answer to
-- "what is attached here?". Any entry that does name a file is linked to it
-- below (a comment's goes to its task), then the three columns are dropped.

ALTER TABLE "files_uploadedfile"
  ADD COLUMN IF NOT EXISTS "task_id" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "client_requirement_id" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "files_uploadedfile_task_id_idx" ON "files_uploadedfile"("task_id");
CREATE INDEX IF NOT EXISTS "files_uploadedfile_client_requirement_id_idx" ON "files_uploadedfile"("client_requirement_id");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'tasks_task' AND column_name = 'attachments') THEN
    UPDATE "files_uploadedfile" AS f
       SET "task_id" = t."id", "project_id" = t."project_id"
      FROM "tasks_task" AS t,
           jsonb_array_elements(CASE WHEN jsonb_typeof(t."attachments") = 'array'
                                     THEN t."attachments" ELSE '[]'::jsonb END) AS a
     WHERE f."task_id" = '' AND f."workspace_id" = t."workspace_id"
       AND f."id" = a->>'fileId';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'tasks_taskcomment' AND column_name = 'attachments') THEN
    UPDATE "files_uploadedfile" AS f
       SET "task_id" = t."id", "project_id" = t."project_id"
      FROM "tasks_taskcomment" AS c
      JOIN "tasks_task" AS t ON t."id" = c."task_id",
           jsonb_array_elements(CASE WHEN jsonb_typeof(c."attachments") = 'array'
                                     THEN c."attachments" ELSE '[]'::jsonb END) AS a
     WHERE f."task_id" = '' AND f."workspace_id" = t."workspace_id"
       AND f."id" = a->>'fileId';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'requirements_clientrequirement' AND column_name = 'attachments') THEN
    UPDATE "files_uploadedfile" AS f
       SET "client_requirement_id" = r."id", "project_id" = r."project_id"
      FROM "requirements_clientrequirement" AS r,
           jsonb_array_elements(CASE WHEN jsonb_typeof(r."attachments") = 'array'
                                     THEN r."attachments" ELSE '[]'::jsonb END) AS a
     WHERE f."task_id" = '' AND f."client_requirement_id" = ''
       AND f."workspace_id" = r."workspace_id"
       AND f."id" = a->>'fileId';
  END IF;
END $$;

ALTER TABLE "tasks_task" DROP COLUMN IF EXISTS "attachments";
ALTER TABLE "tasks_taskcomment" DROP COLUMN IF EXISTS "attachments";
ALTER TABLE "requirements_clientrequirement" DROP COLUMN IF EXISTS "attachments";
