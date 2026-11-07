# Backup and Recovery

**Status: POLICY/PLAN. No backup automation is implemented in this repo — this
documents the required posture; provision it before go-live.**

## What must be backed up
| Asset | Contents | Criticality |
|---|---|---|
| **Postgres** | all domain data | Critical |
| **File blobs** | the `STORAGE_LOCAL_ROOT` volume | Critical |
| **Redis** | queue(1) jobs; cache(0) is ephemeral | Medium (queue only) |
| **Secrets** | JWT, `INTEGRATION_TOKEN_ENC_KEY`, Resend | Critical (in a secret manager, versioned) |

> ⚠️ The **token-encryption key is a backup dependency**: encrypted integration
> tokens are unrecoverable if the key is lost. Back up the key in the secret
> manager with the DB backup and record which key version encrypted the data.

## Targets
- **Postgres:** automated daily full + continuous WAL archiving (PITR). RPO ≤ 5 min, RTO ≤ 30 min. Encrypt backups at rest; retain 30 days + monthly long-term.
- **File volume:** snapshot daily with the database backup (a file row without its blob is a broken download).
- **Redis queue:** AOF/RDB persistence so in-flight jobs survive restart; short RPO acceptable (idempotent consumers).

## Recovery procedures (to validate)
1. **Point-in-time DB restore:** restore base + replay WAL to timestamp; run `prisma db pull` to confirm schema; smoke-test the API.
2. **Blob restore:** restore the volume snapshot taken with the database backup; verify a sample `files/{id}/download`.
3. **Queue restore:** Redis AOF replay; idempotency keys prevent double-processing.
4. **Secret restore:** pull from secret manager; confirm `INTEGRATION_TOKEN_ENC_KEY` version matches the data (decrypt a known row).

## Verification cadence
- Monthly restore drill into a scratch environment (backups are only real if restore is tested).
- Quarterly full DR game-day (see DISASTER_RECOVERY.md).

## Gaps to close before go-live
- ❓ No backup jobs/automation exist yet.
- ❓ No restore drill has been performed.
- ❓ RPO/RTO not yet measured.
