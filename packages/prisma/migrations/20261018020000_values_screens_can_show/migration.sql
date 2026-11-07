-- Values the screens can show, and one way to archive a project.
--
-- A functional requirement always has a priority. One created without one got
-- '' — drawn as "-" in the requirement list but as "Medium" in its dialog and in
-- its edit form — and PATCH accepted any string. Blanks (and anything else that
-- is not a priority) become Medium, the value they were already edited as.
--
-- Creating one validated its status against the client requirement's list, so
-- PROPOSED, ARCHIVED and the like could be stored on a requirement no screen can
-- draw them on. Those become DRAFT; its roll-up moves it on from there.
--
-- A project was archived by its status (which the settings offer) or by an
-- `archived` flag nothing in the product ever set, which hid the project from
-- the list for good. A set flag becomes the status, and the column goes.

UPDATE "requirements_functionalrequirement" SET "priority" = 'MEDIUM'
 WHERE "priority" NOT IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
ALTER TABLE "requirements_functionalrequirement" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';

UPDATE "requirements_functionalrequirement" SET "status" = 'DRAFT'
 WHERE "status" NOT IN ('DRAFT', 'REVIEW', 'APPROVED', 'IMPLEMENTED', 'TESTED', 'DEPLOYED');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'projects_project' AND column_name = 'archived') THEN
    UPDATE "projects_project" SET "status" = 'ARCHIVED' WHERE "archived" = true;
  END IF;
END $$;
ALTER TABLE "projects_project" DROP COLUMN IF EXISTS "archived";

UPDATE "projects_project" SET "status" = 'PLANNING'
 WHERE "status" NOT IN ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');
