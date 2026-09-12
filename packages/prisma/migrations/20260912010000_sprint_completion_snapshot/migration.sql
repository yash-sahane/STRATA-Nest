-- What a sprint actually finished, recorded when it is closed.
--
-- Completing a sprint rolls its unfinished tasks out (their sprint_id is
-- cleared), so a retrospective that counts "tasks whose sprint_id is this one"
-- sees nothing but the DONE ones. Every completed sprint therefore reported a
-- 100% completion rate, which is exactly the number a retrospective exists to
-- question.
--
-- Nullable throughout, deliberately: sprints completed before this migration
-- have no surviving figures to backfill, and inventing a 100% for them would be
-- the same lie written into the database. The UI says so rather than guessing.
ALTER TABLE "sprints_sprint"
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_task_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "total_task_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "rolled_over_task_count" INTEGER;
