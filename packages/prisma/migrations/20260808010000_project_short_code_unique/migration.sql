-- Project: make `short_code` unique per workspace. The code prefixes every task
-- hierarchy id in the project, so two projects sharing one inside a workspace
-- make those ids ambiguous — and the clone flow rewrites the prefix by string
-- replacement, which silently no-ops when the clone derives the source's code.
--
-- DEFENSIVE: clients derive the code from the project name (3 letters), so
-- existing rows may already collide. Disambiguate every duplicate but the
-- OLDEST one before the constraint lands, probing until the candidate is free
-- so the rewrite cannot itself collide.

DO $$
DECLARE
  dup  RECORD;
  n    INT;
  cand TEXT;
BEGIN
  FOR dup IN
    SELECT id, workspace_id, short_code
      FROM (
        SELECT id,
               workspace_id,
               short_code,
               ROW_NUMBER() OVER (
                 PARTITION BY workspace_id, short_code
                 ORDER BY created_at, id
               ) AS rn
          FROM "projects_project"
      ) ranked
     WHERE ranked.rn > 1
  LOOP
    n := 1;
    LOOP
      n := n + 1;
      cand := dup.short_code || n::TEXT;
      EXIT WHEN NOT EXISTS (
        SELECT 1
          FROM "projects_project"
         WHERE workspace_id = dup.workspace_id
           AND short_code = cand
      );
    END LOOP;
    UPDATE "projects_project" SET short_code = cand WHERE id = dup.id;
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "projects_project_workspace_id_short_code_key" ON "projects_project"("workspace_id", "short_code");
