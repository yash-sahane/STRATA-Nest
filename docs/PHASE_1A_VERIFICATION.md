# Phase 1A — Live Verification

> **Gate:** Phase 1 (Auth + Users) is **not** "complete" — and Phase 2 does not begin — until every authentication endpoint here is **✅ Parity Verified** against the live Django app on the shared database.
>
> **Environment honesty:** this sandbox has **no running Django app and no Postgres/Redis** (Docker daemon down). So results below are split into what was **actually executed here** vs what is **PENDING a live run**. No result is fabricated.

## Status legend
- **✅ VERIFIED** — real evidence captured in this environment.
- **🟡 VERIFIED (offline)** — real evidence, but at unit/library level (not full HTTP).
- **⏳ PENDING LIVE RUN** — instrument is written and ready; needs Postgres + Redis + running Django/Nest.

---

## 1. Password verification — ✅ VERIFIED (bidirectional, real Django hasher)

Executed with the **actual Django `PBKDF2PasswordHasher`** (`backend/venv`, no DB) against the shipping `PasswordService`. Scripts: [`scripts/verify/pw_django.py`](../scripts/verify/pw_django.py), [`scripts/verify/pw.cjs`](../scripts/verify/pw.cjs).

| Direction | Input | Result |
|---|---|---|
| **Django → Nest** | Django `make_password('TestPass123!')` = `pbkdf2_sha256$870000$mguCvhACodiBTADwkeZ2DM$Fnsc…jY4=` | Nest verify correct → **`true`**, wrong → **`false`** ✅ |
| **Nest → Django** | Nest `hash('RoundTrip#9')` = `pbkdf2_sha256$600000$QcmYtYndH6cBwVix$AVDX…5XgU=` | Django `check_password` correct → **`True`**, wrong → **`False`** ✅ |

**Conclusion:** existing Django users can log in on NestJS, and passwords changed on NestJS remain valid on Django. The single highest migration risk is closed. (Django 5.1 default = 870k iters; Nest writes 600k — both are read via the iteration count embedded in the hash, so either verifies the other.)

Repro:
```bash
PY=backend/venv/Scripts/python.exe
DJ=$("$PY" scripts/verify/pw_django.py make 'TestPass123!')
node scripts/verify/pw.cjs verify "$DJ" 'TestPass123!'      # true
NH=$(node scripts/verify/pw.cjs hash 'RoundTrip#9')
"$PY" scripts/verify/pw_django.py check "$NH" 'RoundTrip#9'  # True
```

---

## 2. JWT verification — ✅ VERIFIED (bidirectional, real Django SimpleJWT)

Executed with **real `rest_framework_simplejwt`** vs the shipping `TokenService`, shared HS256 key. Scripts: [`scripts/verify/jwt_django.py`](../scripts/verify/jwt_django.py), [`scripts/verify/jwt.cjs`](../scripts/verify/jwt.cjs).

| Check | Result |
|---|---|
| Django SimpleJWT-signed token → **Nest verifies** | ✅ `{ user_id: "user-123", token_type: "access", jti: "0ffa65…9916" }` |
| Nest-signed token → **Django SimpleJWT verifies** | ✅ `{ user_id: "user-456", token_type: "access", jti: "08b152…e669" }` |
| Tampered Nest token → Django | ✅ rejected: `VERIFY_FAIL: Token is invalid` |
| Header/alg/claims (`user_id`, `token_type`, `jti`, `exp`, `iat`) | ✅ match SimpleJWT layout |

**Conclusion:** dual-run is real — Django and Nest accept each other's cookies with a shared `SECRET_KEY`. Enables per-endpoint nginx flips with zero forced logouts.

> ⚠ **Security note (feeds §Security checklist):** the cross-verify test emitted `InsecureKeyLengthWarning` because the *test* key was 30 bytes. Production `SECRET_KEY`/`JWT_ACCESS_SECRET` **must be ≥ 32 bytes**.

---

## 3. Cookie comparison

| Attribute | Nest (unit-verified 🟡) | Byte-compare vs Django (⏳) |
|---|---|---|
| names `lt_access` / `lt_refresh` | ✅ | ⏳ |
| `HttpOnly` | ✅ set | ⏳ |
| `Secure` (config) | ✅ false dev / true prod | ⏳ |
| `SameSite` | ✅ `Lax` | ⏳ |
| `Path=/` | ✅ | ⏳ |
| `Max-Age` (900 / 604800 s) | ✅ | ⏳ |
| `Domain` (unset by default) | ✅ omitted | ⏳ |

🟡 Verified by [`cookie.service.spec.ts`](../apps/api/src/modules/auth/services/cookie.service.spec.ts). ⏳ Full `Set-Cookie` byte-for-byte comparison runs in the e2e (`parseSetCookies`) and `cross-verify.mjs` against live responses.

---

## 4. Authentication endpoints — ⏳ PENDING LIVE RUN

Each flips to ✅ when its contract test is green vs Django **and** the e2e is green vs Nest (both need the DB).

| Endpoint | Instrument | Status |
|---|---|---|
| `POST auth/login` | e2e + contract | ⏳ |
| `POST auth/logout` | e2e | ⏳ |
| `POST auth/refresh` (rotation) | e2e | ⏳ |
| `GET auth/me` | e2e + contract | ⏳ |
| `POST auth/register` | e2e | ⏳ |
| `POST auth/change-password` | e2e | ⏳ |
| `PATCH auth/profile` | e2e | ⏳ |
| `POST auth/password-reset` (+ confirm) | e2e | ⏳ |
| `POST users/invite` | e2e | ⏳ |
| `GET users/`, `GET/PATCH users/:id` | e2e | ⏳ |

Nest e2e: [`apps/api/test/auth.e2e-spec.ts`](../apps/api/test/auth.e2e-spec.ts). Contract: [`packages/contract-tests`](../packages/contract-tests).

---

## 5. Cross-verification matrix — ⏳ PENDING LIVE RUN

Instrument: [`scripts/verify/cross-verify.mjs`](../scripts/verify/cross-verify.mjs).

| # | Flow | Expected | Status |
|---|---|---|---|
| 1 | Django login → Nest `/me` | 200, same user | ⏳ |
| 2 | Nest login → Django `/me` | 200 | ⏳ |
| 3 | Django login → Nest refresh → Nest `/me` | 200/200 | ⏳ |
| 4 | Nest login → Django refresh → Django `/me` | 200/200 | ⏳ |

(§1–§2 already prove the cryptographic basis for all four; this confirms it over HTTP end-to-end.)

---

## 6. Refresh replay (D1) — 🟡 unit-proven, ⏳ full-HTTP pending

- 🟡 `RefreshTokenStore` rotation/revocation unit-verified ([`refresh-token.store.spec.ts`](../apps/api/src/modules/auth/services/refresh-token.store.spec.ts)).
- ⏳ Full HTTP replay: the e2e test **"refresh rotates; REUSING the old refresh token is rejected"** runs with `AUTH_STRICT_REFRESH=true` and asserts the reused token → `401 {message:"Invalid refresh token"}`.

## 7. Multi-tab / concurrent refresh — ⏳ PENDING
The frontend dedupes via `refreshInFlight`; server-side a per-jti revoke makes reuse fail. Live check: fire two concurrent `refresh` with the same cookie → exactly one 200, the other 401; no corruption. (Add as a concurrent e2e case during the live run.)

## 8. Browser verification — ⏳ MANUAL (do not skip)
Against the real frontend, not Postman:
- [ ] Login → refresh page (session persists)
- [ ] Idle ~20 min (access expires) → next request silent-refreshes
- [ ] Open a second tab → still authenticated
- [ ] Logout in one tab → other tab loses session on next request
- [ ] Login again works
- [ ] Password reset email link completes end-to-end

---

## How to run the full gate (in an env with Postgres + Redis + Django)

```bash
# 0. Infra + schema (Django owns the schema during strangler)
#    start Postgres + Redis; then:
cd backend && python manage.py migrate            # creates accounts_user, workspaces_* …
python manage.py runserver 8000 &                 # Django (contract/characterization target)

# 1. Nest against the SAME database
cp .env.example .env   # set DATABASE_URL, REDIS_*, JWT_ACCESS_SECRET = Django SECRET_KEY
pnpm prisma:pull && pnpm prisma:generate
pnpm --filter @lt/api build && node apps/api/dist/main.js &   # Nest on 8001

# 2. Evidence
pnpm --filter @lt/api test:e2e                                   # Nest-side flows (§4,§6,§7)
CONTRACT_BASE_URL=http://localhost:8000 pnpm --filter @lt/contract-tests test   # Django baseline
CONTRACT_BASE_URL=http://localhost:8001 pnpm --filter @lt/contract-tests test   # Nest parity
DJANGO_URL=http://localhost:8000 NEST_URL=http://localhost:8001 EMAIL=… PASSWORD=… \
  node scripts/verify/cross-verify.mjs                          # §5 matrix
```

## Sign-off
Phase 1 is **complete** only when §3–§8 are all ✅ (§1–§2 already ✅). Then proceed to Phase 2 (Workspaces + RBAC).
