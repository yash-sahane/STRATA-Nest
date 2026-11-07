# STRATA — Auth Security Checklist (OWASP ASVS: Authentication & Session)

> Code-review assessment of the auth implementation against OWASP ASVS V2 (Authentication) and V3 (Session Management), L1–L2. This is a **static review of the shipping code**; items marked ⏳ get confirmed in the live run.
>
> **Status:** ✅ Pass · 🟡 Partial / by-config · ⏳ Verify-live · ❌ Gap (action required)

## Summary of actionable items
1. ✅ **Rate limiting implemented** (`@nestjs/throttler`, env-configurable): login 5/min·IP, refresh 20/min·IP, password-reset 3/hr·(IP+email); baseline 120/min. There is no self-registration endpoint: accounts are created by a workspace manager (`POST /users/invite`). 🟡 Two follow-ups: (a) **multi-instance** deployments need a **shared (Redis) throttler storage** (default store is in-memory/per-instance); (b) **persistent account lockout** intentionally deferred (product decision).
2. 🟡 **CSRF** relies on `SameSite=Lax` + credentialed CORS; add a double-submit CSRF token **if `SameSite=None` is ever required** (cross-site).
3. ⏳ **Signing key length** — ensure `JWT_ACCESS_SECRET` is **≥ 32 bytes** (test emitted an insecure-key-length warning at 30 bytes).
4. ✅ **Strict refresh** — always on: a refresh token the Redis allowlist does not hold (rotated, logged out, or never tracked) is refused. There is no compatibility mode.

---

## Session fixation — ✅
- Every `login`/`refresh` issues **new** access + refresh tokens with a **fresh `jti`** (`AuthService.issueSession`); no client-supplied session identifier is trusted. Rotation on refresh prevents fixation of a long-lived token. (ASVS 3.2.1, 3.2.3)

## Cookie flags — ✅ (🟡 by-config for Secure)
- `HttpOnly` always; `SameSite` from config (`Lax` default); `Secure` from config (**must be `true` in prod**); `Path=/`; `Max-Age` 900/604800 s; `Domain` omitted unless configured. Verified: [`cookie.service.spec.ts`](../apps/api/src/modules/auth/services/cookie.service.spec.ts). (ASVS 3.4.1–3.4.5)
- Action: confirm `JWT_COOKIE_SECURE=true` in the prod environment; ⏳ verify `Set-Cookie` attributes in the live run.

## CSRF — 🟡 Partial
- Cookie-borne JWT is CSRF-relevant for state-changing requests. Current defenses: **`SameSite=Lax`** (browsers omit the cookie on cross-site non-safe requests) + **credentialed CORS restricted to known origins**.
- **Action:** acceptable for same-site (`Lax`). If deploying with `SameSite=None` (cross-site frontend), **add a double-submit CSRF token** (the frontend already reads a `csrftoken` cookie and sends `X-CSRFToken`). (ASVS 4.2.2 / 13.2.3)

## Replay / refresh reuse — ✅
- Refresh **rotation revokes the old `jti`** in Redis (`RefreshTokenStore`), closing the refresh-token replay gap. Unit-proven; full-HTTP proven by the e2e reuse-rejection test.
- Only a `jti` the allowlist holds renews a session, so a replayed refresh always 401s (ASVS 3.3.1). The former `AUTH_STRICT_REFRESH=false` compatibility mode is gone.

## Access-token revocation — 🟡 (accepted)
- Access tokens are stateless (15-min TTL); a stolen access token stays valid until expiry even after logout. Mitigated by the **short TTL** + refresh revocation. This matches typical JWT designs. (ASVS 3.3.x — documented residual risk)

## Logout — ✅
- `logout` revokes the refresh `jti` and clears both cookies (`AuthService.logout` + `CookieService.clearAuth`); `204`. (ASVS 3.3.1)

## Password storage — ✅
- `pbkdf2_sha256` (verify uses embedded iterations; writes 600k). **Bidirectionally cross-verified against an independent reference implementation** (Python hashlib). No plaintext, no reversible storage. (ASVS 2.4.1, 2.4.3)

## Password reset — ✅
- Single-use token in Redis, **1-hour TTL**, deleted on use (`PasswordResetStore`); **constant-time** response that never reveals whether the email exists (`AuthService.requestPasswordReset`). `uid` is opaque base64url of the id. (ASVS 2.5.x)
- ⏳ Confirm end-to-end via the browser checklist; the reset email is queued via the worker; the token flow itself is complete.

## Credential enumeration — ✅
- Login failure returns a generic `Invalid email or password` (401 `AuthenticationFailed`) regardless of which factor failed — unknown address, wrong password or switched-off account — and pays for a password hash either way; reset is constant-time. (ASVS 2.2.1)

## Brute-force / rate limiting — ✅ (🟡 storage + lockout)
- **Implemented** via `@nestjs/throttler` (`AuthThrottlerGuard`, global, runs **before** auth): login 5/min·IP, refresh 20/min·IP, password-reset 3/hr·(IP+email); env-configurable (`THROTTLE_*`). Honors `X-Forwarded-For`. Unit-tested (tracker) — [`auth-throttler.guard.spec.ts`](../apps/api/src/throttling/auth-throttler.guard.spec.ts). (ASVS 2.2.1)
- 🟡 **Multi-instance:** default storage is in-memory (per-process) → effective limit = instances × limit. **Before scaling out, switch to a shared Redis throttler storage** (we already run Redis).
- 🟡 **Account lockout:** persistent lockout intentionally **deferred** (product decision). Rate limiting covers the immediate brute-force risk.

## Observability / audit logging — ✅ (NEW)
- Structured JSON logging (pino) with a **correlation id** on every request (`X-Request-Id`, honored inbound or generated, echoed on the response). Secrets/cookies/passwords **redacted**.
- `AuthAuditService` emits structured events — `auth.login.success/failure`, `auth.refresh.rotated/rejected`, `auth.logout`, `auth.password.changed`, `auth.password_reset.requested/completed` — each carrying the correlation id (via pino's request context) so an audit line ties back to its HTTP request. Failures log at WARN for alerting. (ASVS 7.1.x, 7.2.x)

## JWT hardening — ✅ (⏳ key length)
- HS256, explicit `algorithms: ['HS256']` on verify (no `alg:none` / algorithm-confusion), `token_type` checked, `exp` enforced (`ignoreExpiration:false`). (ASVS 3.5.x)
- ⏳ **Action:** signing key ≥ 32 bytes (see summary item 3).

## Transport security — 🟡 by-config
- HSTS + secure cookies belong to the prod deployment (nginx/Helmet). Confirm in the prod profile. (ASVS 9.1.x)

## Authorization scope — ✅
- Global `JwtAuthGuard` protects all routes except `@Public()`; users directory scoped to shared workspaces; self-update enforced. Full per-permission RBAC is enforced when `RBAC_ENFORCED=true`. (ASVS 4.x)

---

### Verdict
No critical vulnerabilities in the auth design; the crypto foundations are proven. Before production sign-off, close the outstanding rate-limiting follow-ups (shared Redis throttler storage for multi-instance) and the ⏳ **key-length** check, and decide CSRF posture based on the final `SameSite` choice. These items are tracked here; they must be resolved before the production sign-off but do not hold up continued development.
