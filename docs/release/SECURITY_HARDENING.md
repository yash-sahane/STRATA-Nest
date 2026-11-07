# Security Hardening

**Status: IMPLEMENTED + unit-verified + boot-verified + LIVE-VERIFIED.** No
unsafe production default remains that the app will silently accept.

## Live verification this sprint (real Postgres + Redis + running API)
- Booting with weak/missing secrets under `NODE_ENV=production` genuinely
 refuses to start (real process, real exit, real error message — not just a
 unit-tested code path).
- A hardened production env genuinely boots and serves traffic.
- Integration `accessToken` confirmed stored as `enc:v1:...` ciphertext via a
 direct DB query (not just asserted by a mock) and confirmed never present in
 any API response.
- GitHub webhook HMAC-SHA256 verification confirmed live: valid signature over
 the raw body → `202` + commit recorded by the worker; tampered/wrong
 signature → `401`.
- **A real boolean-parsing bug was caught by this sprint's own env-hardening
 test** (`z.coerce.boolean("false") === true`), confirming the test itself has
 teeth, not just decorative coverage.

## Changes made this sprint

### 1. Production env fail-fast (`packages/config/src/env.schema.ts`)
`validateEnv` now `superRefine`s in `NODE_ENV=production` and **refuses to boot** on:
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` shorter than 32 chars (weak signing key).
- Missing/short `INTEGRATION_TOKEN_ENC_KEY` (< 32) — token encryption at rest.
- `JWT_COOKIE_SECURE` not true (auth cookies must be HTTPS-only).

**Boot-verified:** launching with weak prod secrets aborts with:
```
Invalid environment configuration:
 - JWT_ACCESS_SECRET: JWT_ACCESS_SECRET must be ≥ 32 chars in production (weak signing key).
 - JWT_REFRESH_SECRET:...
 - INTEGRATION_TOKEN_ENC_KEY:...
 - JWT_COOKIE_SECURE: must be true in production...
```
A fully-hardened prod env boots cleanly (reaches DB connect).

### 2. Boolean env footgun fixed (correctness + security)
`z.coerce.boolean()` maps the **string** `"false"` (and `"0"`, `"no"`) to **`true`**
(`Boolean(str)` is truthy). This silently inverted safety flags — e.g.
`RBAC_ENFORCED=false` and `JWT_COOKIE_SECURE=false` would both have been
**true**. Replaced with an explicit `boolEnv` parser
(`true/1/yes/on` → true; `false/0/no/off/""` → false). Unit-tested.

### 3. Token cipher fails closed (`token-cipher.ts`)
`TokenCipher` now **throws** if `INTEGRATION_TOKEN_ENC_KEY` is empty under
`NODE_ENV=production` (defense-in-depth behind the env gate) instead of falling
back to a predictable derived key.

### 4. Swagger gated (`main.ts`)
OpenAPI UI (`/api/docs`) is served only when **not** production, or when
`SWAGGER_ENABLED=true`. The API schema is not exposed by default in prod.

### 5. Helmet production profile (`main.ts`)
Production enables HSTS (`maxAge=1y; includeSubDomains; preload`); dev relaxes
HSTS/CSP so local tooling + Swagger work.

## Tests
`apps/api/src/config/env-hardening.spec.ts` (6 cases): dev-relaxed OK, prod-hardened OK,
weak JWT rejected, missing enc key rejected, non-Secure cookie rejected, boolean parsing.

## Standing controls (verified by inspection, unchanged)
- Global `JwtAuthGuard` (authorized-by-default) + `@Public` opt-out.
- `PermissionsGuard` + membership scoping; RBAC flag-gated.
- Refresh-token rotation + revocation; rate limiting (Redis-backed).
- Cookies `httpOnly:true`, `sameSite` configurable; secret redaction in pino logs.
- Webhook HMAC verified over raw body with `timingSafeEqual`; storage path-traversal guard.

## Residual security items (NOT done this sprint — tracked)
- 🟡 **CSRF token** — relying on `SameSite=Lax`; add token if `SameSite=None` is ever needed.
- 🟡 **SSRF** — worker Discord dispatch + webhook egress have no host allowlist.
- 🟡 **Email HTML passthrough** — `email/send-*` `html` is member-supplied, unsanitized (goes to Resend, not rendered by us).
- 🟡 **Account lockout** — deferred (product decision).
- ❓ **Dependency CVEs** — `pnpm audit` wired into CI but not executed here.
