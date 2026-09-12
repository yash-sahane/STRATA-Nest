-- Task: add a real completion timestamp. Every completion trend/burndown used to
-- bucket DONE tasks by `updated_at`, so re-titling a task finished in March moved
-- it into the August bucket. Additive and nullable; the backfill below keeps the
-- existing (updated_at-based) numbers stable for rows already DONE.

-- AlterTable
ALTER TABLE "tasks_task" ADD COLUMN     "completed_at" TIMESTAMP(3);

-- Backfill: best available approximation for tasks that are already complete.
UPDATE "tasks_task" SET "completed_at" = "updated_at" WHERE "status" = 'DONE';
