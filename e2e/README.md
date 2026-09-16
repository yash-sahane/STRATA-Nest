# End-to-end regression suite

These checks drive the **real API and a real browser against a running stack**. They are not
unit tests and they do not mock: a check passes only if the thing it describes actually
happens, end to end, in the product.

```bash
pnpm --filter @strata/e2e test:e2e
```

## What it needs running

| | |
|---|---|
| Postgres + Redis | `docker start strata-postgres-1 strata-redis-1` |
| API | `pnpm --filter @strata/api build && node apps/api/dist/main.js` (port 8000) |
| Frontend | `pnpm --filter @strata/frontend build && pnpm --filter @strata/frontend start` (port 3000) |

The frontend must be **built**, not in dev mode — several checks measure computed CSS and
compiled class names, and a dev build resolves those differently.

## How a check is written here

The suite exists because a previous version of it reported green while measuring very
little. Four habits came out of that, and they are worth keeping:

**Say what you could not measure.** A check that silently skips is indistinguishable from
one that passes. `judge()` in `color-utils.mjs` returns `unmeasured` rather than `null`
precisely because `null` used to mean "nothing to report" — and so an unparseable colour
counted as a pass. Tailwind v4 writes its palette in `lab()`, which the parser did not
read, so the entire default palette was invisible to the contrast sweep while it printed
totals as though it had looked.

**Prefer a rendering to an inference.** Focus visibility is judged by screenshotting the
element focused and blurred and comparing the pixels, because reading `box-shadow` caught a
`transition-all` mid-flight and accused a component that had been correct all along.

**Make a clean result falsifiable.** `verify-reflow`, `verify-a11y-structure` and
`verify-layout-shift` each inject a fault at the end and require the detector to report it.
Sixteen routes scoring CLS 0 means nothing unless inserting a 320px block moves the number
— it does, to 0.229.

**Skip loudly, never silently.** `verify-attendance-truth` reports whether today is a
working day and records its date-dependent checks as SKIPPED when it is not. Those checks
passed "12/12" twice purely because the suite kept running on a Sunday, while the bug they
existed to catch sat there untouched.

## Layout

Flat, on purpose. Every script imports `./kit.mjs` and `./color-utils.mjs` by relative
path; sorting them into subdirectories would mean editing all 47 to gain tidiness.

| | |
|---|---|
| `regression-suite.mjs` | the runner — the registered list lives here |
| `kit.mjs` | provisioning, sessions, `api()`, `signedInPage()` |
| `session-cache.mjs` | cookie reuse across scripts, and `freshSession` |
| `color-utils.mjs` | colour parsing (rgb, lab, oklab, oklch) and contrast |
| `verify-*.mjs`, `*-fixes.mjs` | the checks |
| `sweep-*.mjs` | broad walks that report findings rather than pass/fail |

## Adding a check

Print `PASS  <what is true>` / `FAIL  <what is true>` per assertion and end with
`total N  passed N  failed N  skipped N`. The runner parses that line, and salvages the
PASS/FAIL lines if a script dies before printing it — a crash used to report `0/0` and
erase the thirteen checks that had already passed.

Then add it to the list in `regression-suite.mjs`.

## The sweeps

`sweep-*` walk broadly and report findings instead of asserting. They are not in the runner
because they have no pass/fail tally; run them by hand after a change with wide reach.

```bash
pnpm --filter @strata/e2e sweep:routes     # 22 routes x 2 themes x 2 viewports
pnpm --filter @strata/e2e sweep:dialogs    # every dialog, both themes
pnpm --filter @strata/e2e sweep:entry      # login, reset, onboarding, 404
pnpm --filter @strata/e2e sweep:roles      # every route as every role
```

## A note on load

The whole suite shares one `THROTTLE_DEFAULT_LIMIT` budget (120 requests / 60s), and a full
run will cross it. `api()` waits out a 429 rather than spending against it. If a check fails
with an empty page, confirm it is not the limiter before hunting for a UI fault — the app's
rate-limited state is a correct "we couldn't load this, try again", which a check looking
for a control will otherwise report as a missing control.
