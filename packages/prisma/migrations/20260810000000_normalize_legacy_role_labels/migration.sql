-- Data repair only — NO schema change.
--
-- The old invite / add-members UI wrote the role DISPLAY LABEL ('Manager
-- (Admin)', 'Software Developer', 'Software Developer Intern', …) into the role
-- columns instead of the canonical key. `permissionsForRole()` does not know
-- those strings, so every such member silently resolved to the READ_ONLY floor
-- server-side and rendered as "Member" client-side. A pending invite carrying a
-- label would mint another broken membership on redemption.
--
-- New writes can no longer create them (UsersService.invite and
-- WorkspaceAccessService.assertValidRole now reject an unknown role), so this
-- maps the rows already in the database back to their canonical key.
--
-- DEFENSIVE: a workspace may legitimately define a CUSTOM WorkspaceRole whose
-- name is one of these labels, and such a member ALREADY resolves correctly via
-- the custom-role lookup. Every statement therefore skips rows whose workspace
-- defines a WorkspaceRole with that exact name. Re-running is a no-op.

CREATE TEMPORARY TABLE "_legacy_role_labels" (
    "label" TEXT PRIMARY KEY,
    "canonical" TEXT NOT NULL
);

INSERT INTO "_legacy_role_labels" ("label", "canonical") VALUES
    ('Manager (Admin)', 'MANAGER'),
    ('Manager', 'MANAGER'),
    ('Assistant Manager', 'ASSISTANT_MANAGER'),
    ('Software Developer', 'SOFTWARE_DEVELOPER'),
    ('Software Developer Intern', 'DEVELOPER_INTERN'),
    ('Developer Intern', 'DEVELOPER_INTERN'),
    -- Legacy uppercase key retired by 5617577; never a valid role.
    ('SOFTWARE_DEVELOPER_INTERN', 'DEVELOPER_INTERN'),
    ('Tester', 'TESTER'),
    ('Content Engineer', 'CONTENT_ENGINEER'),
    ('Member', 'MEMBER');

-- Workspace memberships: the rows that decide permissions.
UPDATE "workspaces_workspacemember" m
SET "role" = l."canonical"
FROM "_legacy_role_labels" l
WHERE m."role" = l."label"
  AND NOT EXISTS (
      SELECT 1 FROM "workspaces_workspacerole" r
      WHERE r."workspace_id" = m."workspace_id" AND r."name" = l."label"
  );

-- Account-level role (drives the header/profile role badge and USER_ROLES).
UPDATE "accounts_user" u
SET "role" = l."canonical"
FROM "_legacy_role_labels" l
WHERE u."role" = l."label"
  AND NOT EXISTS (
      SELECT 1 FROM "workspaces_workspacerole" r
      WHERE r."workspace_id" = u."workspace_id" AND r."name" = l."label"
  );

-- Un-redeemed invites, which would otherwise mint a fresh broken membership.
UPDATE "workspaces_invitecode" i
SET "role" = l."canonical"
FROM "_legacy_role_labels" l
WHERE i."role" = l."label"
  AND NOT EXISTS (
      SELECT 1 FROM "workspaces_workspacerole" r
      WHERE r."workspace_id" = i."workspace_id" AND r."name" = l."label"
  );

UPDATE "workspaces_emailinvitation" e
SET "role" = l."canonical"
FROM "_legacy_role_labels" l
WHERE e."role" = l."label"
  AND NOT EXISTS (
      SELECT 1 FROM "workspaces_workspacerole" r
      WHERE r."workspace_id" = e."workspace_id" AND r."name" = l."label"
  );

UPDATE "workspaces_pendingworkspaceaccess" p
SET "requested_role" = l."canonical"
FROM "_legacy_role_labels" l
WHERE p."requested_role" = l."label"
  AND NOT EXISTS (
      SELECT 1 FROM "workspaces_workspacerole" r
      WHERE r."workspace_id" = p."workspace_id" AND r."name" = l."label"
  );

DROP TABLE "_legacy_role_labels";
