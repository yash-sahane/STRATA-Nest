-- Task and Epic: make `hierarchy_id` unique per project.
--
-- Same defect and the same shape as 20260811000000_fr_hierarchy_id_unique, one
-- entity over. The id is the human-facing key: it is what a person reads on a
-- card, quotes in a comment, and searches for. It is allocated client-side as
-- COUNT+1, so deleting a row frees a number the next create hands out again, and
-- two concurrent creates read the same count. Both produce two rows claiming the
-- same id, and from then on "AAN-003" identifies nothing in particular.
--
-- Measured before this: two POST /tasks with an identical hierarchyId in one
-- project both returned 201, and two concurrent POST /epics with the same id
-- both returned 201.
--
-- DEFENSIVE: existing rows may ALREADY hold duplicates — that is the bug — so a
-- bare CREATE UNIQUE INDEX would abort the migration. Renumber every duplicate
-- but the OLDEST one first, probing until the candidate is free so the rewrite
-- cannot itself collide. The bump mirrors bumpHierarchyId() in
-- apps/api/src/modules/generation/hierarchy-id.service.ts: increment the trailing
-- numeric segment in place, preserving its zero padding (`…-01` -> `…-02`,
-- `….09` -> `….10`); an id with no numeric tail gets `-01`.

DO $$
DECLARE
  tbl  TEXT;
  dup  RECORD;
  cand TEXT;
  m    TEXT[];
  free BOOLEAN;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tasks_task', 'epics_epic'] LOOP
    FOR dup IN
      EXECUTE format(
        'SELECT id, project_id, hierarchy_id
           FROM (
             SELECT id, project_id, hierarchy_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY project_id, hierarchy_id
                      ORDER BY created_at, id
                    ) AS rn
               FROM %I
           ) ranked
          WHERE ranked.rn > 1', tbl)
    LOOP
      cand := dup.hierarchy_id;
      LOOP
        m := regexp_match(cand, '^(.*[-.])(\d+)$');
        IF m IS NULL THEN
          cand := cand || '-01';
        ELSE
          cand := m[1] || lpad(((m[2])::BIGINT + 1)::TEXT, length(m[2]), '0');
        END IF;
        EXECUTE format(
          'SELECT NOT EXISTS (SELECT 1 FROM %I WHERE project_id = $1 AND hierarchy_id = $2)', tbl)
          INTO free USING dup.project_id, cand;
        EXIT WHEN free;
      END LOOP;
      EXECUTE format('UPDATE %I SET hierarchy_id = $1 WHERE id = $2', tbl) USING cand, dup.id;
    END LOOP;
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_task_project_id_hierarchy_id_key" ON "tasks_task"("project_id", "hierarchy_id");
CREATE UNIQUE INDEX "epics_epic_project_id_hierarchy_id_key" ON "epics_epic"("project_id", "hierarchy_id");
