-- A project runs one sprint at a time, and the database holds that rule.
--
-- Two ACTIVE sprints in one project make "the current sprint" ambiguous: every
-- screen that resolves it picks the first row it reads, so the board, the
-- backlog and the analytics could each describe a different sprint. The API
-- checked before starting one, but a check followed by a write lets two starts
-- that arrive together both pass. It closed that with an advisory lock whose
-- work went through a second pooled connection per start — the shape that
-- stalled the whole API when time entries did it. This index is the rule
-- instead: the second of two simultaneous starts fails here, and the API
-- answers it as it answers the check.
--
-- Prisma's schema cannot express a partial index (see the note on model Sprint):
-- if `prisma migrate dev` ever generates a DROP INDEX for it, delete that line
-- from the generated migration.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "sprints_sprint" WHERE "status" = 'ACTIVE'
    GROUP BY "project_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING MESSAGE =
      'Some projects have more than one ACTIVE sprint. Complete all but one in each '
      || '(SELECT project_id, id, name FROM sprints_sprint WHERE status = ''ACTIVE'' ORDER BY project_id) '
      || 'and apply this migration again.';
  END IF;
END $$;

CREATE UNIQUE INDEX "sprints_one_active_per_project"
  ON "sprints_sprint" ("project_id")
  WHERE "status" = 'ACTIVE';
