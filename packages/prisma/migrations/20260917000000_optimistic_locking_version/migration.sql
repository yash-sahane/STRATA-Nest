-- A version counter, so two people editing the same field cannot silently overwrite
-- each other.
--
-- An earlier fix stopped a save carrying values that were stale from the moment the dialog
-- opened, which removed the common and worst case: somebody losing a change to a field the
-- other person never touched, with no error shown to either of them. What it cannot cover
-- is two people editing the SAME field. There the last write still wins outright, because
-- `ScopedCrudService.update` was a plain `prisma.update({ where: { id }, data })` with
-- nothing to compare against.
--
-- WHAT THIS COLUMN IS, AND IS NOT:
--
-- It is NOT sent to clients and no client sends it back. The conflict check is per FIELD:
-- an update carries `basedOn`, the values the editor believed the fields they are writing
-- held, and the server refuses the save only if one of THOSE has moved. That distinction
-- is the whole point. A row-level version check refuses two people editing different
-- fields as well, which is the ordinary case — one retitles a task while another
-- reprioritises it — and sends one of them away to redo work that clashed with nothing.
--
-- This column is the token that makes the check atomic. The server reads the row, decides
-- whether those fields still hold what the editor believed, and then writes CONDITIONALLY
-- on the version it read, so a third save landing between the read and the write cannot
-- slip past the comparison.
--
-- WHY NOT `updated_at`, which every one of these tables already has:
--
-- `updated_at` moves whenever ANYTHING writes the row, including work no human did.
-- `SprintCompletedTaskRoller` runs `task.updateMany({ where: { sprint_id, status != DONE },
-- data: { sprint_id: '' } })` when a sprint completes, touching every incomplete task in
-- it. Conditioning on `updated_at` would make every one of those writes lose its race and
-- retry for a change nobody made. This column moves only on the update path that bumps it;
-- background writers use `updateMany` and leave it alone.
--
-- DEFAULT 0 and NOT NULL, so every existing row starts at a known value and a client that
-- sends no `basedOn` simply omits the check — the behaviour before this migration.

ALTER TABLE "tasks_task" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "epics_epic" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sprints_sprint" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "projects_project" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "requirements_clientrequirement" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
