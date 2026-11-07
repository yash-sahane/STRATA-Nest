-- Six tables and one column that the API stored and served, and that no screen ever
-- read or wrote.
--
--   activity_savedsearch                 saved searches: full CRUD, no client
--   sprints_retrospective                three lists per sprint; the retrospective people
--                                        actually write is sprints_sprint.retrospective_notes
--   tasks_kanbancolumn                   per-project board columns; the board draws the five
--                                        task statuses and never asked
--   tasks_label                          a label catalogue; a task's labels are the JSON on
--                                        the task itself
--   workspaces_emailinvitation           invitations by token: nothing issued one and nothing
--                                        mailed the token
--   workspaces_pendingworkspaceaccess    a second "ask to join" queue beside join requests,
--                                        with no approve step
--   workspaces_workspace.invite_code     minted at creation and printed as "share this code",
--                                        but never looked up by the route that redeems codes
--                                        (those live in workspaces_invitecode)
--
-- THIS DELETES DATA. Anything in these tables got there through the API by hand, or from
-- the demo-data script (which wrote one retrospective); export it first if it matters.
--
-- IF EXISTS throughout, so the migration is safe to re-run and safe on a database that
-- already lost one of these.
--
-- The column is dropped rather than its index: dropping a column takes every index and
-- constraint on it along, whichever of the two a given database has —
-- "workspaces_workspace_invite_code_key" is a unique INDEX where the baseline migration
-- created it and a unique CONSTRAINT on a database that predates the baseline, and
-- DROP INDEX fails on the second. The legacy "..._invite_code_6e9d587b_like" index goes
-- the same way.

ALTER TABLE "workspaces_workspace" DROP COLUMN IF EXISTS "invite_code";

DROP TABLE IF EXISTS "activity_savedsearch";
DROP TABLE IF EXISTS "sprints_retrospective";
DROP TABLE IF EXISTS "tasks_kanbancolumn";
DROP TABLE IF EXISTS "tasks_label";
DROP TABLE IF EXISTS "workspaces_emailinvitation";
DROP TABLE IF EXISTS "workspaces_pendingworkspaceaccess";
