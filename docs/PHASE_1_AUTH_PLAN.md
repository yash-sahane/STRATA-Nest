# Phase 1 — Auth + Users: Implementation Plan

> **Gate document.** No Auth code is written until this is complete and approved. Grounded in the audit ([CURRENT_SYSTEM_AUDIT.md](CURRENT_SYSTEM_AUDIT.md) §5) and ADR-0009. Companion DoD: [phases/PHASE_1.md](phases/PHASE_1.md).

## 1. Objectives

1. Port authentication + the user directory to NestJS with **byte-identical** wire behavior (ADR-0003).
2. Preserve cookie-JWT UX (`lt_access`/`lt_refresh`) so the frontend (`rest-client.ts` silent refresh) works unchanged.
3. **Fix D1**: make refresh tokens revocable (rotation actually invalidates the old token).
4. Enable **dual-run**: during dark-launch, a session started on Django is valid on Nest and vice-versa (cross-verifiable tokens), so nginx can flip traffic per-endpoint without logging anyone out.
5. Ship the characterization → contract → flag pipeline for every Phase-1 endpoint.

## 2. Existing Django auth flow (as-is, A§5)

- **Password store:** Django `PBKDF2-SHA256` (`pbkdf2_sha256$<iters>$<salt>$<b64hash>`).
- **Tokens:** SimpleJWT, **HS256** signed with `SECRET_KEY` (single `SIGNING_KEY`). Access 15 min, refresh 7 d. Claims: `token_type`, `exp`, `iat`, `jti`, `user_id` (= `User.id`, the 20-char string).
- **Transport:** httpOnly cookies `lt_access`/`lt_refresh`; `JWTCookieMiddleware` copies the access cookie into `Authorization: Bearer` so DRF auth sees it; `JWTCookieAuthentication` also reads the cookie directly.
- **login** → `authenticate(email,password)` → `RefreshToken.for_user(user)` → set both cookies → `200 {user: <User>, sessionId: <jti>}`.
- **logout** → blacklist refresh (best-effort) → delete cookies → `204`.
- **refresh** → read refresh cookie → `set_jti()` + `set_exp()` (manual rotate) → set cookies → `200 {ok:true}`. ⚠ **does not blacklist the old token** (D1); the SimpleJWT rotation/blacklist settings never take effect.
- **me** → `{user, session:{id,userId,current:true}, workspaceIds, hasTempPassword, isAdmin}`. ⚠ queries `WorkspaceMember` **without** `status="ACTIVE"` filter (D17) — differs from the scoping used elsewhere.
- **change-password** → verify current → set new → clear `has_temp_password`.
- **profile** (PATCH) → `name`/`phone`/`avatar`.
- **register** → `validate_password` → `create_user` → tokens.
- **password-reset** → `PasswordResetTokenGenerator`; `uid = urlsafe_base64(pk)`; email link `${FRONTEND_URL}/reset-password?uid=&token=`; **constant-time** response (never reveals existence).
- **password-reset/confirm** → decode uid → `check_token` → set password → clear temp.
- **users/invite** → existing user: add `WorkspaceMember` + invite email → `{type:"invitation"}`; new user: `create_user` (temp password) + membership + welcome email → `{type:"new_user"}`. Authz: any **ACTIVE member** OR workspace owner OR platform admin (**no role gate**).
- **users** directory: list peers sharing ≥1 workspace (admins see all); retrieve; update (self or admin only).

## 3. NestJS auth flow (to-be)

- **Module split:** `AuthModule` (sessions/passwords) + `UsersModule` (directory). Auth lives in the module — **no `packages/auth`** (ADR-0001).
- **Passport strategies:** `JwtStrategy` (cookie extractor for `lt_access`), plus a `LocalStrategy`-style credential check in `AuthService.login`. Global `JwtAuthGuard` + `@Public()` on login/register/refresh/reset.
- **Token service:** signs HS256 with the **same signing key + claim layout** as SimpleJWT (§6). Access = short-lived; refresh carries a `jti` recorded in a **Redis `RefreshTokenStore`** (TTL = refresh lifetime).
- **Endpoints** map 1:1 to §2 (controllers → `AuthService`/`UsersService`; A§14).
- **Refresh (D1 fix):** verify refresh cookie → check `jti` allowed → **rotate: issue new jti, revoke old** → set cookies. Logout deletes the jti.
- **Password hashing:** Django-compatible `pbkdf2_sha256` verify **and** write during dual-run (§6), so Django can still read passwords Nest writes. (Optional argon2 rehash-on-login deferred to post-decommission, Phase 12.)

```
login → verify pbkdf2 → issue access(+refresh jti→Redis) → Set-Cookie → {user, sessionId:jti}
request → JwtAuthGuard (lt_access cookie) → req.user
401 → frontend tryRefresh() → refresh → verify jti in Redis (or compat) → ROTATE (revoke old) → cookies
logout → delete jti → clear cookies → 204
```

## 4. API parity table (Phase 1)

| Endpoint | Response (must match Django) | Notes |
|---|---|---|
| `POST auth/login/` | `200 {user, sessionId}` + cookies | `sessionId` = refresh `jti` |
| `POST auth/logout/` | `204` + cleared cookies | + revoke jti |
| `POST auth/refresh/` | `200 {ok:true}` + rotated cookies | **+ old token revoked** |
| `POST auth/register/` | `201 {user, sessionId}` + cookies | `validate_password` rules |
| `GET auth/me/` | `200 {user, session:{id,userId,current}, workspaceIds, hasTempPassword, isAdmin}` | reproduce D17 first (see §8) |
| `POST auth/change-password/` | `200 {ok:true}` / `400` | clears `hasTempPassword` |
| `PATCH auth/profile/` | `200 <User>` | name/phone/avatar |
| `POST auth/password-reset/` | `200 {ok:true}` | constant-time; email queued/stub |
| `POST auth/password-reset/confirm/` | `200 {ok:true}` / `400` | token semantics preserved |
| `POST users/invite/` | `{success,type,userId,message}` | reproduce "any member" authz (§8) |
| `GET users/` | list `<User>` | shared-workspace scope |
| `GET users/{id}/` | `<User>` | |
| `PATCH users/{id}/` | `<User>` | self/admin only |

`<User>` fields per [API_COMPATIBILITY.md](API_COMPATIBILITY.md#phase-1--auth--users).

## 5. Cookie compatibility

Reproduce exactly (asserted by `parseSetCookies` in contract tests):

| Attribute | Value | Source |
|---|---|---|
| names | `lt_access`, `lt_refresh` | `JWT_ACCESS/REFRESH_COOKIE_NAME` |
| `HttpOnly` | yes | A§5.3 |
| `Secure` | `JWT_COOKIE_SECURE` (false dev / true prod) | env |
| `SameSite` | `Lax` (configurable) | env |
| `Domain` | `JWT_COOKIE_DOMAIN` or unset | env |
| `Path` | `/` | A§5.3 |
| `Max-Age` | access 900 s, refresh 604800 s | SIMPLE_JWT |

Logout/confirm must `delete_cookie` with the same `Path=/` so browsers clear them.

## 6. JWT compatibility (dual-run critical)

To let Django and Nest accept each other's cookies during dark-launch:

- **Algorithm:** HS256.
- **Signing key:** a single key equal to Django `SECRET_KEY`. During transition set `JWT_ACCESS_SECRET = JWT_REFRESH_SECRET = <Django SECRET_KEY>` (SimpleJWT uses one `SIGNING_KEY` for both). Split/rotate only after Django is decommissioned (Phase 12).
- **Claims (replicate SimpleJWT):** `token_type` (`access`/`refresh`), `exp`, `iat`, `jti`, `user_id` = `User.id` (string). `AuthService` reads `user_id` to load the user.
- **Verification:** Nest `JwtStrategy` validates signature + `exp` + `token_type=access`; Django continues to accept Nest-issued tokens because they are structurally identical.

## 7. Refresh-token migration (the D1 fix, done safely)

Existing Django refresh tokens are plain SimpleJWT strings not tracked in Redis. Two-stage rollout:

1. **Compatibility mode (dark-launch):** Nest `refresh` accepts any refresh token that is **signature-valid, unexpired, `token_type=refresh`**, even if its `jti` isn't in Redis (it was issued by Django). On use, it **rotates**: new `jti` stored in Redis; old `jti` recorded as revoked. Logout revokes + best-effort adds to Django's blacklist table during dual-run.
2. **Strict mode (after flip is stable):** require the presented `jti` to be present-and-active in Redis. Now every refresh is fully revocable (D1 closed).

A short **rotation lock** (per user/jti) guards the frontend's concurrent-refresh dedupe (`refreshInFlight`) so a race can't double-rotate.

## 8. Edge cases

- **Reused old refresh after rotation** → `401` in strict mode (the core D1 behavior); a test asserts it.
- **Concurrent refresh** (two tabs) → lock/idempotency; both end with a valid session, old jti revoked once.
- **Expired access + valid refresh** → `401` then silent refresh (unchanged frontend flow).
- **Logout with no refresh cookie** → still `204`, cookies cleared.
- **Inactive user login** → invalid credentials (parity).
- **Duplicate email register** (case-insensitive) → `400` (parity); email lowercased.
- **Temp-password user** → `hasTempPassword:true`; `change-password` clears it.
- **`me` with INACTIVE membership (D17)** → **reproduce Django** (no status filter) for parity; then fix behind a flag once contract is green, and record the change in API_COMPATIBILITY.
- **`users/invite` authz** → **reproduce Django** (any ACTIVE member/owner/admin, no role gate) in Phase 1; the manager-only gate arrives with RBAC in Phase 2 (documented behavior change there).
- **Password reset for unknown email** → constant-time `{ok:true}`.
- **Reset token** (Django `PasswordResetTokenGenerator`) → reproduce token validation, incl. the `uid=urlsafe_base64(pk)` encoding, so existing emailed links keep working during transition.
- **Clock skew** on `exp`/`iat` → small leeway to match SimpleJWT tolerance.
- **SameSite=None** requires `Secure` → validated in prod config.

## 9. Test cases

**Characterization (vs Django, recorded first):** every endpoint in §4 — status, body, and `Set-Cookie` attributes; reset-token happy path; invite existing/new; directory scoping for a member vs admin.

**Contract (vs Nest, must equal Django):** the same suite re-pointed via `CONTRACT_BASE_URL`; cookie-attribute equality via `parseSetCookies`.

**Unit:** token service (claim layout, HS256, jti), pbkdf2 hasher (verify a known Django hash; hash→verify round-trip), `RefreshTokenStore` (store/rotate/revoke), `JwtAuthGuard`/`@Public()`, password validators.

**Integration/e2e (Supertest + `@lt/testing`):**
- login → me → refresh → logout happy path.
- **refresh reuse rejected** (strict mode) — proves D1 fixed.
- concurrent refresh race → single rotation.
- cross-verify: a cookie minted with the Django-equal key is accepted by Nest (dual-run).
- directory scoping and self-update-only.

## Known parity items (tracked, tuned during characterization)

Intentional, documented divergences to verify against real Django output before flipping rows to ✅:

1. **Datetime microseconds** — Django emits 6-digit microseconds; Prisma returns ms-precision `Date`s, so `toDjangoIso` pads `.SSS000Z`. Rows written by Nest are exact; legacy Django rows may differ in the last 3 digits. Resolve per-endpoint via raw-SQL string reads only if a client flow needs it.
2. **Validation error message text** — DRF vs `class-validator` produce different messages for field validation (e.g. an empty login body). The **envelope, status (400), and `type` (`ValidationError`) match**; the message *content* may differ. The frontend surfaces `error.message` generically and does not branch on it.
3. **Error `type` by status** — the exception filter maps status → DRF class name (400→`ValidationError`, 401→`NotAuthenticated`, 403→`PermissionDenied`, 404→`NotFound`). Endpoints that specifically mean `AuthenticationFailed`/`InvalidToken` (401) can pin the exact type; verify during characterization.
4. **JSON key order** — success bodies mirror Django's serializer field order (incl. `createdAt`/`updatedAt` last); asserted structurally by the contract suite.

## 10. Rollback strategy

- **Per-endpoint nginx flag** for `auth/*` and `users/*` → flip back to Django instantly.
- **Additive only:** the Redis `RefreshTokenStore` and (compatibility-mode) token acceptance mean sessions remain valid on either backend during the window — no forced logout on rollback.
- **No destructive DB change:** Phase 1 reads `User`; writes are limited to password/profile updates (same columns Django uses) and the Redis token set. Reverting ignores Redis.
- Django stays authoritative until the flip is 100% and stable for the standby window.

## 11. Definition of Done

- [ ] Every §4 endpoint: characterization captured, Nest implemented, **contract test green** (identical status/body/cookies) → row flipped to ✅ in API_COMPATIBILITY.
- [ ] `login`/`refresh` cookies identical (names, flags, max-age); frontend silent-refresh works unchanged.
- [ ] **Refresh rotation revokes the old token** (strict mode) — dedicated test green (D1 closed).
- [ ] Dual-run verified: a Django-issued cookie is accepted by Nest and vice-versa (shared key + claims).
- [ ] pbkdf2 compatibility: existing Django password hashes validate in Nest; Nest-written hashes validate in Django.
- [ ] `me`, directory scoping, invite, reset flows reproduce Django (edge cases §8 covered), with D17/authz deviations documented, not silently changed.
- [ ] Migration protocol (char → contract → flag) followed for each endpoint; rollback tested (flip back to Django, session intact).
- [ ] `@lt/testing` auth helpers (`mintTestToken`, cookie helpers) in place; unit/integration/e2e suites green.
- [ ] [phases/PHASE_1.md](phases/PHASE_1.md) acceptance criteria all checked.

---

*Approve this plan to begin Phase 1 implementation. Until then, no Auth code is written.*
