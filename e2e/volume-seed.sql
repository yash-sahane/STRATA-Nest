-- Fill a project with a realistic year's worth of tasks, in one statement.
--
-- Seeded as SQL rather than through the API because 2500 creates against a 120-per-60s
-- limiter would take about twenty minutes and starve every other script of its budget.
-- The rows are the same rows; only the door is different.
--
-- Not through Prisma either: the client hoisted to the repo root is generated from a
-- different schema than packages/prisma/schema and does not know every column, so a
-- seed written against it fails on whichever field was added most recently.
--
-- :ws, :proj, :user and :count are bound by the caller.
INSERT INTO tasks_task (
  id, created_at, updated_at, version,
  workspace_id, project_id, hierarchy_id,
  sprint_id, epic_id, functional_requirement_id, parent_task_id,
  title, description, status, priority, completed_at,
  assignee_ids, assignee_names, assigned_by, assigned_by_name,
  created_by_id, created_by_name, due_date,
  estimated_hours, labels,
  position, blocked_by, blocks
)
SELECT
  'vol-' || :'proj' || '-' || i,
  now() - (i || ' minutes')::interval,
  now(),
  0,
  :'ws', :'proj',
  'VOL-' || i,
  '', '', '', '',
  'Volume task ' || i,
  '',
  -- An even spread across the board's five columns, so every count has something in it.
  (ARRAY['BACKLOG','TODO','IN_PROGRESS','REVIEW','DONE'])[1 + (i % 5)],
  (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])[1 + (i % 4)],
  -- Only DONE tasks carry a completion time; burndowns bucket on it.
  CASE WHEN i % 5 = 4 THEN now() - (i || ' minutes')::interval ELSE NULL END,
  -- A third to the manager, a third to the developer, a third unassigned, so the
  -- workload column has a real distribution to divide rather than one heap.
  CASE WHEN i % 3 = 0 THEN jsonb_build_array(:'user') ELSE '[]'::jsonb END,
  CASE WHEN i % 3 = 0 THEN jsonb_build_array('Role MANAGER') ELSE '[]'::jsonb END,
  '', '',
  :'user', 'Role MANAGER',
  now() + ((i % 60) || ' days')::interval,
  NULL, '[]'::jsonb,
  i, '[]'::jsonb, '[]'::jsonb
FROM generate_series(0, :count - 1) AS i
ON CONFLICT (id) DO NOTHING;
