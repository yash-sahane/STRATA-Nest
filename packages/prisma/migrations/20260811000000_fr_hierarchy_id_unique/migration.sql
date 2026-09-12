-- FunctionalRequirement: make `hierarchy_id` unique per project.
--
-- The id is the human-facing key of an FR — it prefixes every task id under it,
-- it is what deep links and the 409 cascade message name, and the deletion
-- service walks the dotted form to find children. It was allocated client-side
-- as COUNT+1, so deleting an FR frees a number that the next create hands out
-- again, and two concurrent creates read the same count. Both produce two rows
-- claiming the same id.
--
-- DEFENSIVE: existing rows may ALREADY hold duplicates — that is precisely the
-- bug this closes — so a bare CREATE UNIQUE INDEX would abort the migration.
-- Renumber every duplicate but the OLDEST one first, probing until the
-- candidate is free so the rewrite cannot itself collide. Same shape as
-- 20260808010000_project_short_code_unique.
--
-- The bump mirrors bumpHierarchyId() in
-- apps/api/src/modules/generation/hierarchy-id.service.ts: increment the
-- trailing numeric segment in place, preserving its zero padding
-- (`…-01` -> `…-02`, `….09` -> `….10`); an id with no numeric tail gets `-01`.

DO $$
DECLARE
  dup  RECORD;
  cand TEXT;
  m    TEXT[];
BEGIN
  FOR dup IN
    SELECT id, project_id, hierarchy_id
      FROM (
        SELECT id,
               project_id,
               hierarchy_id,
               ROW_NUMBER() OVER (
                 PARTITION BY project_id, hierarchy_id
                 ORDER BY created_at, id
               ) AS rn
          FROM "requirements_functionalrequirement"
      ) ranked
     WHERE ranked.rn > 1
  LOOP
    cand := dup.hierarchy_id;
    LOOP
      m := regexp_match(cand, '^(.*[-.])(\d+)$');
      IF m IS NULL THEN
        cand := cand || '-01';
      ELSE
        cand := m[1] || lpad(((m[2])::BIGINT + 1)::TEXT, length(m[2]), '0');
      END IF;
      EXIT WHEN NOT EXISTS (
        SELECT 1
          FROM "requirements_functionalrequirement"
         WHERE project_id = dup.project_id
           AND hierarchy_id = cand
      );
    END LOOP;
    UPDATE "requirements_functionalrequirement" SET hierarchy_id = cand WHERE id = dup.id;
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "requirements_functionalrequirement_project_id_hierarchy_id_key" ON "requirements_functionalrequirement"("project_id", "hierarchy_id");
