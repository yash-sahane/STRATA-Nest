# Incident Response

## Severity levels
| Sev | Definition | Response |
|---|---|---|
| SEV1 | Outage / data loss / security breach | page immediately; all-hands; status page |
| SEV2 | Major degradation, one domain down | page on-call; mitigate < 1h |
| SEV3 | Minor / single-tenant / workaround exists | next business day |

## Flow
1. **Detect** — alert/health/report. Open an incident channel; assign IC.
2. **Triage** — ONCALL_RUNBOOK.md symptom table; correlate by `X-Request-Id`.
3. **Mitigate first** — fastest safe lever:
 - Redeploy the previous image tag or revert a config flag (ROLLBACK.md).
 - `EMAIL_TRANSPORT=inline` for queue issues.
 - Scale/restart api replicas.
 - Rotate secrets on suspected compromise.
4. **Communicate** — status updates on cadence per Sev.
5. **Resolve & verify** — health green, error rate normal, smoke passes.
6. **Post-mortem** — blameless; timeline; root cause; action items (target the gaps below).

## Security incident specifics
- **Token/secret leak:** rotate `INTEGRATION_TOKEN_ENC_KEY` (+ re-encrypt rows), JWT secrets (rotate refresh → sessions invalidated), AWS/Resend keys. Audit `activity_logs`.
- **Auth bypass suspicion:** force logout (rotate the refresh secret, or flush the `refresh:*` allowlist), review `PermissionsGuard`/scoping.
- **Webhook abuse:** confirm signature verification; rotate `webhookSecret`; the endpoints are signature-authed + rate-limited.

## Data-integrity incidents
- Suspected bad `bulk-save` tree or wrong leave-balance deduction → PITR if needed,
 reconcile against the last known-good snapshot.

## Gaps that raise incident risk (track)
- No metrics/alerting → detection relies on health + user reports.
- No DLQ → silent job-failure accumulation.
- Live e2e/perf not yet verified → unknown-unknowns in production.
