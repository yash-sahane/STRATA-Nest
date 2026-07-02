# Phase 11 — Integrations (Webhooks, Git Queue, Token Encryption)

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
