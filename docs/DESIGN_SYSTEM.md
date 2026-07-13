# STRATA — Design System (target spec)

The canonical reference the remediation implements against. **Derived from the existing app** (not invented) — where the app already has a defensible standard, that standard is adopted; where it conflicts, the most-used / most-accessible option wins and the rest converge. Companion to [UI_CONSISTENCY_REPORT.md](UI_CONSISTENCY_REPORT.md) and [UI_UX_REMEDIATION_PLAN.md](UI_UX_REMEDIATION_PLAN.md).

Stack: Tailwind v4 (CSS-first `@theme` in `src/styles/globals.css`), shadcn/ui (new-york, `baseColor: neutral`), lucide icons, sonner toasts, next-themes (default **dark**).

---

## 1. Color

### 1.1 Existing tokens (keep)
HSL CSS variables in `globals.css`, light + `.dark`: `background, foreground, card, card-foreground, popover, popover-foreground, primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground, accent, accent-foreground, destructive, destructive-foreground, border, input, ring, chart-1..5`. Base is the neutral shadcn scale (primary ≈ near-black/near-white).

### 1.2 New semantic tokens (add — resolves DS-01, the #1 root cause)
Add positive/caution/info with contrast-safe foregrounds, both themes:

| Token | Meaning | Light (HSL) | Dark (HSL) | Foreground |
|---|---|---|---|---|
| `--success` | positive / approved / present / done-terminal | `142 71% 45%` | `142 64% 40%` | `--success-foreground` (near-white) |
| `--warning` | caution / pending / on-hold / review | `38 92% 50%` | `38 92% 50%` | `--warning-foreground` (**near-black**, for contrast) |
| `--info` | informational / in-progress-neutral | `217 91% 60%` | `217 74% 55%` | `--info-foreground` (near-white) |

Expose via `@theme inline` (`--color-success: hsl(var(--success))`, etc.) so `bg-success`, `text-success-foreground`, `border-warning` work. Values above are starting points — validate each pairing at AA before committing.

### 1.3 Semantic meaning (single source of truth — resolves COLOR-01/02)
Color communicates **state**, not decoration. One meaning per hue, enforced by `lib/semantic/`:

| Semantic | Token | Used for |
|---|---|---|
| neutral / not-started | `muted` / `secondary` | BACKLOG, TODO, DRAFT, PLANNING |
| in-progress | `info` | IN_PROGRESS (all domains), Active work |
| attention / pending | `warning` | REVIEW, ON_HOLD, PENDING, LATE, HALF_DAY |
| positive / complete / approved | `success` | DONE, DEPLOYED, APPROVED, ACTIVE-project, PRESENT, APPROVED-leave |
| negative / blocked / error | `destructive` | ABSENT, REJECTED, CRITICAL health, blocked |
| priority scale | `muted`→`info`→`warning`→`destructive` | LOW→MEDIUM→HIGH→CRITICAL |

Note the one deliberate reuse: **green/`success` = "done/complete" AND "active project"** — disambiguated by context + label; never use green for two *contradictory* meanings on the same surface. Priority `LOW` is **neutral/muted** (retire the green-vs-gray conflict).

### 1.4 Rules
- Never hand-write raw palette classes (`bg-green-500`, `text-red-600`) for status — use tokens or `lib/semantic/*`. (Retire the 912 raw usages progressively.)
- Status/color logic lives in `lib/semantic/`, **never** in `hooks/` or the data layer.
- Charts read `hsl(var(--chart-1..5))` via `lib/semantic/chart.ts` — no hex literals.
- Every token carries its own dark value; components must not add `dark:` overrides for status color.

---

## 2. Typography

Font: Inter (`next/font`). Type roles (one class string each — enforced by primitives):

| Role | Class | Element | Notes |
|---|---|---|---|
| Page title | `text-2xl font-semibold tracking-tight sm:text-3xl` | `h1` via `PageHeader` | **semibold, responsive** (adopt the primitive; retire the 23 `text-3xl font-bold` hand-rolls) |
| Page description | `text-sm text-muted-foreground sm:text-base` | `p` via `PageHeader` | |
| Section / card title | `text-base font-semibold` (hero stat: `text-lg`) | `CardTitle` | **reduce from `text-2xl`** (TYPO-02) |
| Card description | `text-sm text-muted-foreground` | `CardDescription` | keep |
| Dialog title | `text-lg font-semibold tracking-tight` | `DialogTitle` | keep |
| Stat / KPI value | `text-2xl font-bold` | — | standardize (retire `text-lg`/`semibold` variants) |
| Body | `text-sm` | — | default UI text |
| Meta / caption | `text-xs text-muted-foreground` | — | retire `text-[10px]`/`text-[11px]` |
| Empty-state title | `text-lg font-semibold` | `h3` via `EmptyState` | one treatment (retire the 5 variants) |

Rules: page titles always `h1`; exactly one `h1` per page; headings never skip levels (fix `attendance` `h2`). No arbitrary `text-[Npx]` — use the scale.

---

## 3. Spacing & layout

| Purpose | Value |
|---|---|
| Page outer padding | owned by shell (`px-4 py-5 sm:px-6 lg:px-8`) — pages **do not** add their own |
| Page max-width | `PageContainer` caps content (`max-w-7xl mx-auto`); pages don't set width |
| Section gap (vertical rhythm) | `space-y-6` |
| Card padding | `p-6` (density-aware later, DS-04/SIZE-04) |
| Toolbar/filter gap | `gap-2` controls, `gap-4` groups |
| Form field gap | `space-y-4` |

Scale = Tailwind default (`1`=4px … `6`=24px, `8`=32px). No arbitrary bracket spacing. Radius: `--radius: 0.5rem` (`sm/md/lg` derived) — keep; do not inflate.

---

## 4. Sizing (controls)

| Control | Height | Notes |
|---|---|---|
| Button (default) | `h-9` | + `sm h-8`, `lg h-10`, `icon h-9 w-9` |
| Input / Select / Textarea trigger | **align to Button** (`h-9`) | fixes 40px-vs-36px toolbar misalignment (SIZE-01) |
| Dialog widths | `sm=max-w-md` · `md=max-w-lg` · `lg=max-w-2xl` · `xl=max-w-4xl` (+ `max-h-[90vh]` scroll) | via `DialogContent size` prop (SIZE-02); retire ad-hoc `[500px]`/`6xl` |
| Filter/select width | one standard (`w-[200px]` desktop, full-width mobile) | retire `[250]/[180]/[120]/[400]/[450]` |
| Icon (inline/button) | `h-4 w-4` | de-facto standard (350 uses) — keep |
| Icon (empty-state / large loader) | `h-7 w-7` (empty), `h-8/h-12` (loader) | one value per context |

---

## 5. Components — usage contracts

- **Button** — variants `default/destructive/outline/secondary/ghost/link`; add `loading` prop (spinner + auto-disable). Primary action = `default`; dangerous = `destructive`; secondary/cancel = `outline`.
- **Badge** — `default/secondary/destructive/outline` + token-backed `success/warning/info` (accessible foregrounds). Status badges come from `lib/semantic/*`.
- **Card** — `Card/CardHeader/CardTitle/CardDescription/CardContent/CardFooter`; `CardTitle` `text-base` default.
- **Dialog** vs **Sheet** vs **AlertDialog** vs **Popover** (pattern selection):
  - `Dialog` → short focused task (create/edit ≤ ~8 fields). Footer `[Cancel outline][Submit]`, right-aligned, submit shows loading.
  - `Sheet` (new) → contextual/long/secondary flows (detail panels, AI generation, filter-heavy edits), and mobile nav.
  - `AlertDialog` → destructive/irreversible confirmation. Confirm button = `destructive`.
  - `Popover` → lightweight contextual controls (date pickers, quick selectors).
- **Form** — RHF + zod + `Form/FormField/FormItem/FormLabel/FormControl/FormMessage` for all create/edit. Labels above fields; required marked; validation on submit + blur; errors in `FormMessage`.
- **Table** — always the `Table` primitive in an `overflow-x-auto` wrapper; empty state as an in-table `colSpan` row; `truncate`/`min-w-0`/responsive `hidden lg:table-cell`; `DataTable` adds pagination + optional `onRowClick`. (`team/page.tsx` table is the reference.)
- **Board** — one configurable `<Board columns cardRenderer onDragEnd>`; columns/colors from `lib/semantic/status.ts`.
- **Shell** — `PageContainer` → `PageHeader` (title/description/actions) → `PageToolbar` (`SearchInput` + `FilterBar`) → content (`DataView` states).

---

## 6. States — the page/async contract

Every data surface implements these five states consistently:

| State | Pattern |
|---|---|
| **Loading (initial, structured)** | `Skeleton` matching content shape |
| **Loading (section/list)** | `InlineLoader` |
| **Loading (action/submit)** | `Button loading` (spinner + disabled); never a full-page swap |
| **Refetch (background)** | keep existing content; subtle indicator only |
| **Empty (first-use)** | `EmptyState` with icon + title + description + **CTA** |
| **Empty (no results)** | `EmptyState` no-results mode + "Clear filters" (distinct from first-use) |
| **Error** | `ErrorState` with message + **Retry**; never raw backend error text; never an infinite spinner |
| **Data** | the content |

Feedback: **sonner only**. `toast.success` on mutation success, `toast.error` on failure (friendly message). Destructive/irreversible actions require `useConfirm()`/`AlertDialog` first — no silent deletes. Forms disable submit while pending (no double-submit).

Route boundaries: `app/global-error.tsx`, `app/(dashboard)/error.tsx`, `app/not-found.tsx` — styled, using `ErrorState`/`EmptyState`.

---

## 7. Motion

| Class of motion | Duration | Use |
|---|---|---|
| Micro-interaction | 100–150ms | hover color, focus ring, small toggles |
| Standard component | 150–200ms | dropdowns, tabs, accordion |
| Overlay | 200–300ms | dialog/sheet enter-exit, popover |
| Large layout | 300–400ms | sidebar collapse |

Rules: motion communicates state change / hierarchy / spatial relationship — no decorative animation. Easing consistent (default Tailwind `ease-out` in, `ease-in` out). **Respect `prefers-reduced-motion: reduce`** globally (A11Y-01) — neutralize transitions/animations but keep essential progress spinners. Keep `next-themes disableTransitionOnChange`.

---

## 8. Accessibility baseline

- Contrast ≥ WCAG AA for text and status colors (validate token foregrounds §1.2).
- Every interactive element keyboard-reachable; visible `focus-visible` ring (don't remove outlines without a replacement).
- Icon-only buttons carry `aria-label`/`sr-only` text (audit all `size="icon"`).
- Dialogs/menus/tooltips via Radix (labels, focus trap, Escape) — preserve.
- One `h1` per page; semantic headings; form controls associated with labels.
- Honor `prefers-reduced-motion`.

---

## 9. Anti-patterns (do not)

Raw palette classes for status · color logic in hooks/data layer · hex chart colors · hand-rolled headers/empty/loading/spinners · `window.confirm` · silent destructive actions · Radix `useToast` (dead) · new competing primitives · arbitrary `text-[Npx]`/`w-[Npx]` for standard roles · `CardTitle` as a page title · removing focus outlines · full-page loader on background refetch.
