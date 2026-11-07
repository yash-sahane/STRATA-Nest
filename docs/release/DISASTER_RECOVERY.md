# Disaster Recovery

**Status: PLAN. DR has not been drilled — run a game-day before go-live.**

## Objectives (proposed, to be ratified)
- **RTO** ≤ 1 hour (full region loss); **RPO** ≤ 5 min (Postgres PITR).

## Scenarios & recovery
| Disaster | Recovery |
|---|---|
| **API region/cluster down** | fail over to standby region (IaC re-provision); stateless api/worker redeploy from images; point at replica DB promoted to primary |
| **Postgres primary loss** | promote replica; repoint `DATABASE_URL`; verify schema via introspection; resume |
| **Redis loss** | recreate; cache/socket rebuild automatically; queue restored from AOF (idempotent) or re-driven; throttler fails open meanwhile |
| **File volume loss** | restore the volume snapshot taken with the database backup |
| **Data corruption (bad deploy/migration)** | PITR to just before the event; redeploy the previous image tag while reconciling |
| **Secret compromise** | rotate all secrets; re-encrypt integration tokens with a new key; invalidate sessions (rotate refresh secret) |

## Runbook (region failover, high level)
1. Declare DR; freeze writes if possible.
2. Promote DB replica in standby region; verify replication lag/consistency.
3. Deploy api+worker images to standby; inject env from the secret manager (incl. correct `INTEGRATION_TOKEN_ENC_KEY` version).
4. Repoint DNS/nginx; run post-deploy smoke (DEPLOYMENT.md).
5. Validate realtime, queues, auth; monitor.

## Gaps to close
- ❓ No standby region / IaC DR automation defined.
- ❓ No DR game-day executed; RTO/RPO unproven.
- ❓ Backup restore path unverified (BACKUP_AND_RECOVERY.md).
