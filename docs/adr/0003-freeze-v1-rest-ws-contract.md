# ADR-0003 — Freeze the v1 REST/WS contract

- Status: Accepted
- Date: 2026-06-30
- Deciders: Principal Architect, Staff Engineer, Frontend Lead

## Context
The Next.js frontend hard-codes the wire contract: camelCase fields, the `{items,total,page,pageSize}` pagination envelope, the `{error:{message,code,type}}` error envelope, cookie names `strata_access`/`strata_refresh`, the collection slugs (`COLLECTIONS` in `frontend/src/lib/api/config.ts`), and the WS frame `{event,payload,channels,timestamp}`. The generic query filter's operators are also relied upon.

## Decision
Treat the **v1 contract as frozen.** The API holds every envelope, field name, cookie, slug, and WS frame stable. Behavior may improve (correctness, auth, integrity) but **shapes do not change** under `/api/v1`. Any breaking shape goes to a future `/api/v2`.

## Consequences
- (+) The frontend does not change shape when the backend evolves within v1.
- (+) Contract tests lock the wire shapes and catch accidental drift.
- (−) Some quirks (snake↔camel per-field mapping, a generic filter) must be implemented carefully; the query filter uses a per-resource allowlist without changing the request shape.
- A contract test suite is generated from `frontend/src/lib/api/*` to guard the v1 shape.

## Alternatives considered
- **Redesign the API cleanly:** rejected for v1 — it would force a synchronized frontend rewrite in the same release.

## Amendment — 2026-10-18
The freeze exists so that the frontend never has to change with the backend. Its only
client is the frontend in this repository, so within v1 a shape may still lose something
that misleads rather than informs, provided that client changes in the same commit:

- a field that never carried data, or that another field already says: `attachments` on
  tasks, task comments and client requirements (always `[]`; a file names what it is
  attached to — `taskId` / `clientRequirementId` on the file); a project's `archived`
  flag (nothing set it; the status Archived is how a project is archived);
- an endpoint with no caller left: `POST /email/send-notification` (the one mail a
  browser asked for, "your password was changed", is sent by the server where the
  password changes);
- a second door to a write that has one with rules: the generic create, update and
  delete on `leave_balances` beside `POST /leave_balances/adjust` (which keeps an
  approver off their own allowance and tells the member), and writes to
  `git_commits`, which arrive only from the provider's webhook.

The same rule, applied again later the same day:

- one name per fact: a task's and a functional requirement's people are `assigneeIds`
  with `assigneeNames` (written by the server; `assignedTo` / `assignedToNames` are
  gone), and a user's email and workspace are `email` and `workspaceId` (`userEmail`,
  `defaultWorkspaceId` and a member's `userName` are gone);
- fields nothing shows or decides by: task `watcherIds`, `customFields`, `actualHours`;
  epic `assignedTeam`; requirement `tags`, `linkedProjectIds`, `reusable`; project
  `logo`, `color`, `methodology`, `memberIds`, `settings`; workspace `logo`, `color`;
  timer `type`, `pomodoroSettings`; time entry `type`, `billableRate`, and its
  accepted-then-ignored `duration`;
- roll-ups are the server's: an epic's `status`/`progress` and a requirement's
  `progress` are no longer accepted on create or update;
- second spellings: `PUT /:id` beside `PATCH /:id` on twenty collections (the
  notification preferences' `PUT`, a real replace, stays), upload's `workspace_id` /
  `project_id`, `GET /files/:id/preview` beside `/view`, and the list query's
  reserved `page_size` / `format`.

Additions stay additive. The envelopes, cookie names, collection slugs and the WS frame
are unchanged, and a change any other client would notice still goes to `/api/v2`.

