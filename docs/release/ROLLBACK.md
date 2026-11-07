# Rollback

STRATA is the only backend; there is no separate service to route traffic back to.
Rollback is limited to redeploying a previous image or reverting a config/env flag.

## Levels of rollback (fastest first)
1. **Image rollback (minutes):** redeploy the previous api/worker image tag
 (immutable, git-sha tagged). Stateless — safe.
2. **Config rollback:** revert an env flag (`RBAC_ENFORCED`, `EMAIL_TRANSPORT`)
 without redeploy where the platform allows.

## Data considerations
- **Additive migrations** (`notifications_notificationdelivery`, `core_idempotencykey`)
 are backward-compatible with older image tags; no data rollback needed.
- **Token encryption:** `TokenCipher.decrypt` tolerates plaintext rows, so a
 partial encrypt migration is safe to pause/rollback. Keep the key-wrap step reversible.
- **No destructive schema changes** are made without a dedicated, reviewed migration.

## When to roll back
- Data-integrity error on a served collection.
- Sev1/Sev2 with no fast fix.
- Failed post-deploy smoke.

## Procedure
1. Identify blast radius (one collection vs all).
2. Redeploy the previous image tag and/or revert the config flag.
3. Confirm the symptom clears.
4. File incident + post-mortem (INCIDENT_RESPONSE.md); fix; re-attempt deploy.
