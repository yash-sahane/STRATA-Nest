# Changelog

All notable **architectural** changes (not git commits) are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0.

## [0.1.0] — Unreleased · Release 0.1: Foundation Freeze

Foundation for the Django → NestJS migration. **Phase 1 is not "complete" until the live
Phase 1A gate passes** (contract/e2e/benchmark/browser vs real Django + Postgres + Redis).

### Added
- **Migration docs (audit-first):** Current System Audit, Migration Matrix, Target Architecture,
  12 ADRs, per-phase Definition-of-Done (0–12), API compatibility ledger, migration-status dashboard.
- **Monorepo scaffold** (pnpm/turborepo): `apps/api`, `apps/worker`; packages
  `common`, `config`, `shared`, `prisma`, `testing`, `contract-tests`.
- **`@lt/common`:** byte-parity id generator, frozen error/pagination envelopes, allowlisted
  query parser, `toDjangoIso`, DRF-error-type mapping.
- **Auth + Users (Phase 1):** cookie JWT (SimpleJWT-compatible), Django `pbkdf2` passwords,
  **revocable refresh tokens** (Redis jti store), directory scoping, invite flow.
- **Rate limiting** (`@nestjs/throttler`), env-configurable per endpoint.
- **Structured logging** (pino) with per-request **correlation ids** + secret redaction.
- **`AuthAuditService`:** structured authentication audit events.
- **Infra:** Docker (api/worker), docker-compose (pg/redis/api/worker/nginx), nginx WS upgrade.
- **Test harness:** contract/characterization suite; auth unit + e2e (e2e pending live env).

### Changed
- **Build model:** workspace packages emit their own `dist` and resolve via `node_modules`
  (replaced the non-runnable source-consumption approach).
- **Repository Pattern is opt-in**, not the default — services call Prisma directly (ADR-0004).
- **Domain events carry business meaning** (no generic `*Updated`) (ADR-0006).
- `packages/shared` split into typed sub-areas; event contracts under `shared/events`.
- Target data model normalizes labels/permissions and promotes soft FKs → nullable relations (ADR-0008).

### Fixed
- **D1:** refresh tokens are now revocable — rotation invalidates the old `jti` (the original
  Django security gap where rotation never blacklisted).

### Security
- Refresh rotation/revocation; per-endpoint rate limiting; log redaction; auth-by-default guard.
- **Deferred / tracked:** Redis throttler storage (multi-instance), CSRF token (if `SameSite=None`),
  account lockout, JWT signing-key-length enforcement, strict-refresh cutover.

[0.1.0]: https://example.invalid/releases/tag/v0.1.0
