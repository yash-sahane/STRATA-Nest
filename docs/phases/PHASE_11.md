# Phase 11 — Integrations (Webhooks, Git Queue, Token Encryption)

**Status: 🚧 Implemented + unit-verified; live contract/e2e pending a DB+Redis+worker environment.**
Done: `IntegrationsModule` — CRUD for `github_integrations`, `gitlab_integrations`, `discord_integrations`, `git_commits`. **[NEW] D4:** `TokenCipher` (AES-256-GCM, key from `INTEGRATION_TOKEN_ENC_KEY`) encrypts `accessToken` at rest; the field is write-only (never serialized) — a test proves plaintext is never persisted. **[NEW] D5:** integrations/commits are scoped by the project→workspace relation (Django left them unscoped) — no schema change. **[NEW] webhooks:** public `integrations/{github,gitlab}/webhook/{projectId}` verify the provider signature over the **raw body** (HMAC-SHA256 / shared token) and enqueue to the `git` queue; the **worker** `GitProcessor` records commits idempotently (unique project+sha), parses task refs → `linkedTaskIds`, auto-advances tasks to DONE on close-intent when `autoUpdateStatus`, and dispatches to Discord. Typecheck + DI graph green for **both api and worker**; **91 api + 7 worker unit tests**.
**Deferred/deviations (documented):** existing token rows need a one-time encrypt-in-place data migration at the live gate; `integration:write` is manager-level (a tightening vs Django's unguarded access); provider API back-fetch is not needed (commits come from the webhook payload); `git` enqueue→processed integration test needs live Redis+DB.
Pending: token-migration run + reconciliation, live webhook signature/e2e, Discord dispatch verification.

## Goal
Port integration config/records **and build the missing server-side behavior** — webhook receivers, provider API calls, auto-status — plus encrypt access tokens at rest (A§6.12, D4).

## Scope
- `IntegrationsModule`: `github_integrations`, `gitlab_integrations`, `discord_integrations`, `git_commits` (CRUD parity).
- **[NEW]** webhook controllers (verify signature → enqueue), `git` BullMQ queue (fetch commits, auto-update task status), Discord dispatch.
- **Encrypt** `accessToken` columns (KMS/pgcrypto/app-level); add `workspaceId` to scope integration models/commits (closes D5).

## Out of Scope
- New provider types beyond GitHub/GitLab/Discord.
- AI/generation (Phase 12).

## Deliverables
- Integration Prisma models (encrypted tokens, `workspaceId`); webhook controllers; `git` processor.
- `IntegrationSubscriber` reacting to relevant events (e.g., link commits to tasks).
- Char + contract tests for CRUD; webhook signature + processing tests.

## Acceptance Criteria
- [ ] Integration CRUD byte-identical (tokens remain `write_only` — never echoed).
- [ ] Tokens stored encrypted; a test proves plaintext is never persisted (closes D4).
- [ ] Integrations/commits scoped by workspace (no cross-workspace listing) — closes D5.
- [ ] Inbound webhooks verified + processed idempotently via the `git` queue **[NEW]**.
- [ ] Migration protocol followed.

## Rollback Strategy
nginx flags per collection + webhook routes. Webhook processing is new and behind flags; disabling it reverts to config-only records (current behavior). Token encryption ships with a migration that encrypts in place; keep a reversible key-wrapping step.

## Risks
- **Token encryption migration** on existing rows → run as a guarded data migration with verification; keep the key in a secret store.
- **Webhook signature schemes** per provider → covered by provider-specific tests before enabling.
