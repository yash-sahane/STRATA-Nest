# STRATA — UI/UX Consistency Report

**Scope:** `apps/frontend` (Next.js 16 App Router · React 19 · Tailwind v4 · shadcn/ui · React Query · recharts · @hello-pangea/dnd · sonner)
**Method:** Read-only source audit of 169 TS/TSX files — 28 routes, 29 UI primitives, 20 component domains — cross-verified by four parallel domain audits (pages, forms/dialogs, boards/colors, cross-cutting styling) plus targeted grep quantification.
**Status:** Audit complete. **No production UI code has been modified.** This document + [UI_UX_REMEDIATION_PLAN.md](UI_UX_REMEDIATION_PLAN.md) + [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) are the gate before implementation.

---

## 1. Executive summary

STRATA is built on a sound foundation — real shadcn/ui primitives, semantic design tokens, React Query, a canonical `PageHeader`/`EmptyState`/`PageLoader`, and a clean monorepo. The problem is **not** the toolkit; it is that **the toolkit is inconsistently adopted**. Screens were built independently, each re-deriving patterns the design system already provides. The result reads as ~25 separate mini-apps sharing a sidebar.

Five systemic root causes generate the large majority of the ~55 issues below:

1. **The design-token vocabulary is incomplete.** There is no `--success` / `--warning` / `--info` token — only `--destructive`. Every "green = good / yellow = pending / blue = info" decision therefore has no home, so **912 raw Tailwind palette classes across 56 files** invent it ad-hoc, including inside the data layer (`lib/*-utils.ts`, `hooks/use-team.ts`). This is the origin of the semantic-color chaos (§5, COLOR-*).
2. **Shared abstractions exist but are not adopted.** `PageHeader` is used on **2 of 28 pages**; `EmptyState` in **2 files**; the shared `PriorityBadge` is **never rendered**. 26 pages hand-roll headers, 20+ sites hand-roll empty states, and 6 files hand-roll priority colors that now *conflict*.
3. **Two toast systems coexist and the wired-up one is unmounted.** The only mounted `<Toaster>` is sonner's, but **9 core data hooks and 6 components** call the Radix `useToast`, whose renderer does not exist. **The success/error feedback for nearly all CRUD in the app is silently dropped** (TOAST-01, P0).
4. **Async states have no shared contract.** Query *errors* are surfaced **nowhere** (`isError` appears 0 times); loading uses 6 different idioms with no `Skeleton` primitive; there are no route-level `loading.tsx` / `error.tsx` / `not-found.tsx` boundaries.
5. **The application shell under-specifies page structure.** The layout supplies only padding — no max-width, no page container, no standard title/toolbar — so each page invents its own width, padding, title size, and toolbar, producing four container idioms and a four-way title-typography fork.

**Severity rollup:** 2 × P0, 16 × P1, 27 × P2, 10 × P3 (55 issues).
**Highest-leverage fixes** (Wave 1–2 in the plan) touch ~8 files — tokens, Badge, Button/Input, Dialog, the toast unification, and a semantic-color module — and resolve or de-risk ~30 of the 55 issues before a single page is redesigned.

---

## 2. Architecture & blast-radius model

```
Root layout (app/layout.tsx)              ← theme, sonner Toaster, providers      [HIGHEST blast radius]
  └ Providers (auth, query, theme, workspace)
     └ Dashboard layout ((dashboard)/layout.tsx)  ← shell: sidebar + header + <main> (padding only, NO max-width)
        └ Sidebar / Header               ← nav, search, user menu
           └ Page (28 route page.tsx)    ← each hand-rolls header/container/toolbar/states
              └ Domain components        ← dialogs, boards, tables, cards
                 └ UI primitives (components/ui/*)  ← Button, Input, Dialog, Badge…   [HIGH blast radius]
                    └ Design tokens (styles/globals.css)                              [HIGHEST blast radius]
```

**Fix altitude rule applied throughout this report:** fix at the highest safe level. A padding bug shared by 17 pages is a shell fix, not 17 page fixes; a priority-color conflict in 6 files is one semantic-color module, not 6 edits.

---

## 3. Severity & category legend

| Sev | Meaning |
|---|---|
| **P0 — Critical** | Blocks task completion, causes data-loss risk, or removes essential feedback. |
| **P1 — High** | Major inconsistency/usability or accessibility problem on common workflows. |
| **P2 — Medium** | Noticeable UX/design inconsistency affecting quality/efficiency. |
| **P3 — Low** | Polish; limited user impact. |

**Categories:** Design System · Color · Toast/Feedback · Error Handling · Loading · Empty States · Layout · Typography · Sizing · Dialogs · Forms · Destructive Flow · Navigation/IA · Tables · Boards · Accessibility · Animation/Interaction · User Flow · Duplication · Responsive.

**Fix Level** legend: `Token` · `Primitive` · `Shared component` · `Shell/Layout` · `Domain` · `Page`.

---

## 4. Root-cause map

| Root cause | Generates issues | Deepest fix |
|---|---|---|
| RC1 — Missing `success/warning/info` tokens | COLOR-01…08, DS-03, A11Y-02 | `Token` |
| RC2 — Shared abstractions under-adopted | LAYOUT-01, TYPO-01, EMPTY-01, COLOR-01, BOARD-01 | `Shared component` + migration |
| RC3 — Dual toast, Radix renderer unmounted | TOAST-01, FORM-06 | `Primitive`/wiring |
| RC4 — No async-state contract | ERROR-01/02, LOAD-01…04, EMPTY-01 | `Shared component` + `Shell` |
| RC5 — Shell under-specifies page structure | LAYOUT-01…05, TYPO-01, SIZE-01 | `Shell/Layout` |
| RC6 — Primitives drift from stock spec | SIZE-01, DIALOG-01, TYPO-02, DS-02 | `Primitive` |

---

## 5. Issue register

> Each issue lists: Category · Severity · Frequency · Affected routes/components · User impact · Root cause · Evidence (`file:line`) · Recommended fix · Fix level · Dependencies · Effort · Regression risk.

### Design System & Tokens

---
**DS-01 — No `success` / `warning` / `info` semantic tokens**
- **Category:** Design System · **Severity:** P1 · **Frequency:** App-wide (root cause of 8+ COLOR issues)
- **Affected:** `styles/globals.css`; consumed everywhere status/priority/health color is needed.
- **User impact:** Status color has no single source of truth, so it drifts per screen and per mode; dark-mode status colors are hand-tuned inconsistently.
- **Root cause:** Token set stops at `--destructive` + `--chart-1..5`; no positive/caution/info semantics.
- **Evidence:** `styles/globals.css:38-92` defines background/foreground/card/primary/secondary/muted/accent/destructive/border/input/ring/chart-1..5 and **nothing else**.
- **Recommended fix:** Add `--success`, `--warning`, `--info` (+ `-foreground`) in light & dark; map to Tailwind via `@theme inline`. Foundation for all COLOR-* fixes.
- **Fix level:** `Token` · **Dependencies:** none (do first) · **Effort:** S · **Regression risk:** Low.

---
**DS-02 — `Badge` success/warning/info variants hardcode palette + fail contrast**
- **Category:** Design System / Accessibility · **Severity:** P1 · **Frequency:** Badge is used app-wide.
- **Affected:** `components/ui/badge.tsx`; every status badge.
- **User impact:** `warning` badge is **white text on `yellow-500`** (~1.7:1 contrast) — effectively unreadable; WCAG AA fail. Variants also bypass tokens, so they can't respond to theme.
- **Root cause:** RC1 — no tokens, so the primitive inlined palette colors.
- **Evidence:** `components/ui/badge.tsx:14-16` — `success:'bg-green-500 text-white'`, `warning:'bg-yellow-500 text-white'`, `info:'bg-blue-500 text-white'`.
- **Recommended fix:** After DS-01, rewire to `bg-success text-success-foreground` etc. with accessible foregrounds (dark text on warning).
- **Fix level:** `Primitive` · **Dependencies:** DS-01 · **Effort:** S · **Regression risk:** Low.

---
**DS-03 — Chart tokens exist but are bypassed by two conflicting hardcoded hex palettes**
- **Category:** Color · **Severity:** P2 · **Frequency:** 5 analytics/chart files, ~23 hex literals.
- **Affected:** `analytics/page.tsx`, `sprints/[id]/analytics/page.tsx`, `analytics/workspace/page.tsx`, `analytics/team/page.tsx`, `components/sprints/burndown-chart.tsx`.
- **User impact:** Charts don't match the product palette and are unreadable/low-contrast in one theme; two files use different "series 1" colors.
- **Root cause:** `--chart-1..5` tokens defined but never referenced.
- **Evidence:** `analytics/page.tsx:51` `['#0088FE','#00C49F','#FFBB28','#FF8042','#8884D8']`; `sprints/[id]/analytics/page.tsx:31-35` `#3b82f6,#22c55e,#f59e0b,#ef4444,#6b7280`; strokes `#8884d8` (`analytics/page.tsx:303`) vs `#3b82f6` (`analytics/workspace/page.tsx:133`).
- **Recommended fix:** Single `chartColors` helper reading `hsl(var(--chart-n))`; one Recharts theme wrapper.
- **Fix level:** `Shared component` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

---
**DS-04 — Fragile `.compact-mode` / `.no-animations` global overrides**
- **Category:** Design System · **Severity:** P2 · **Frequency:** Settings-driven, affects all pages unevenly.
- **Affected:** `styles/globals.css`; Settings density toggle.
- **User impact:** "Compact mode" only shrinks elements that happen to use `space-y-4/6`, `p-4/6`, `gap-4/6`; any page using `p-8`, `gap-3`, `space-y-8` (e.g. `attendance` `p-8`) ignores it → density is partial and unpredictable.
- **Root cause:** Density implemented as `!important` overrides on a fixed list of utility classes rather than a token scale.
- **Evidence:** `styles/globals.css:104-131`.
- **Recommended fix:** Drive density from a spacing token/`data-density` attribute the primitives read; or scope compact to the shell container.
- **Fix level:** `Token`/`Shell` · **Dependencies:** spacing scale (DS-05) · **Effort:** M · **Regression risk:** Medium (touches global spacing).

---
**DS-05 — No documented spacing / radius / motion scale; `components.json` references a non-existent config**
- **Category:** Design System · **Severity:** P3 · **Frequency:** Repo-wide.
- **Affected:** `components.json`, all files.
- **User impact:** Contributors have no canonical scale, so arbitrary bracket values proliferate (see SIZE-03, TYPO-03).
- **Evidence:** `components.json:7` points to `tailwind.config.ts` which **does not exist** (Tailwind v4 is CSS-first via `@theme` in `globals.css`).
- **Recommended fix:** [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) documents the scales; fix/remove the stale `components.json` path.
- **Fix level:** `Token`/docs · **Dependencies:** none · **Effort:** S · **Regression risk:** None.

### Color & Semantic Meaning (RC1 + RC2)

---
**COLOR-01 — Six conflicting priority→color maps; shared `PriorityBadge` never rendered**
- **Category:** Color / Duplication · **Severity:** P1 · **Frequency:** 6 files, every task/FR/requirement surface.
- **Affected:** `components/tasks/priority-badge.tsx` (unused), `tasks/task-board.tsx`, `sprints/sprint-board.tsx`, `tasks/task-details-dialog.tsx`, `requirements/page.tsx` + `client-requirement-detail-dialog.tsx`, `functional-requirements/page.tsx`, `lib/notification-utils.ts`.
- **User impact:** The same priority looks different on the board vs its own details dialog; the visual language for "how urgent" is unlearnable.
- **Root cause:** RC2 — a shared `getPriorityConfig()` exists but is only used for its numeric `.score`; every renderer re-invents the color.
- **Evidence:** `LOW` = `bg-gray-400` on `task-board.tsx:95` but **green** in all 5 other maps; `MEDIUM` = yellow everywhere except **blue** in `notification-utils.ts:92`; icons for HIGH differ (AlertTriangle `priority-badge.tsx:35` / AlertCircle `task-board.tsx` / Flag `sprint-board.tsx`); `task-board.tsx:64` defines a `color` field that is never read (dead).
- **Recommended fix:** One `lib/semantic/priority.ts` (color + token + icon + label + score); render everything through `PriorityBadge`.
- **Fix level:** `Shared component` + migration · **Dependencies:** DS-01/02 · **Effort:** M · **Regression risk:** Low-Medium.

---
**COLOR-02 — Cross-domain hue collision: the same color carries opposite meanings**
- **Category:** Color · **Severity:** P1 · **Frequency:** App-wide semantic ambiguity.
- **Affected:** boards, project/sprint/epic/FR/leave/attendance status.
- **User impact:** **Green = "Done"** for tasks/FRs but **"Active/ongoing"** for projects/sprints; **blue = TODO / In-Progress / Approved / Completed / Medium-priority** depending on file; **yellow = In-Progress / Medium / Review / On-Hold / Pending**. Color cannot be trusted as a signal.
- **Root cause:** RC1 — no semantic layer defining what each hue *means*.
- **Evidence:** green "Done" `task-board.tsx:61` vs green "Active" `projects/page.tsx:78` (`success`) / `sprints/page.tsx:145`; IN_PROGRESS **yellow** `task-board.tsx:59` vs **blue** `sprint-board.tsx:55` — and blue is TODO on the task board.
- **Recommended fix:** Define a semantic status taxonomy (neutral / in-progress / positive-terminal / caution / negative) mapped to tokens; apply per-domain via one config so meanings stop colliding.
- **Fix level:** `Shared component` · **Dependencies:** DS-01, COLOR-01 · **Effort:** M · **Regression risk:** Medium.

---
**COLOR-03 — Functional-Requirement status map duplicated 4× verbatim**
- **Category:** Duplication · **Severity:** P2 · **Frequency:** 4 files.
- **Evidence:** identical `DRAFT gray · REVIEW yellow · APPROVED blue · IMPLEMENTED purple · TESTED indigo · DEPLOYED green` at `functional-requirements/page.tsx:31`, `functional-requirement-detail-dialog.tsx:50`, `sprints/fr-assignment-card.tsx:23`, `epic/epic-detail-dialog.tsx:206`.
- **User impact:** Any status/color change must be made in 4 places; they will drift.
- **Recommended fix:** `lib/semantic/status.ts` — one FR status map, imported everywhere.
- **Fix level:** `Shared component` · **Dependencies:** DS-01 · **Effort:** S · **Regression risk:** Low.

---
**COLOR-04 — Project (2×) & Requirement (2×) status maps duplicated**
- **Category:** Duplication · **Severity:** P2 · **Frequency:** 4 files.
- **Evidence:** project map verbatim in `projects/page.tsx:70` + `projects/[projectId]/page.tsx:29`; requirement map + priorityConfig verbatim in `requirements/page.tsx:42,58` + `client-requirement-detail-dialog.tsx:42,58`.
- **Recommended fix:** fold into `lib/semantic/status.ts`.
- **Fix level:** `Shared component` · **Dependencies:** DS-01 · **Effort:** S · **Regression risk:** Low.

---
**COLOR-05 — Attendance status color duplicated; the copy silently drops `HOLIDAY`**
- **Category:** Duplication / Color · **Severity:** P2 · **Frequency:** 2 files.
- **Evidence:** canonical `lib/attendance-utils.ts:381 getAttendanceStatusColor` (handles case variants + HOLIDAY) vs inline copy `components/attendance/team-attendance-tab.tsx:62 getStatusColor` (UPPER-only, **no HOLIDAY**).
- **User impact:** Holidays render with the fallback color on the team tab only — inconsistent between personal and team views.
- **Recommended fix:** delete the inline copy; import the util.
- **Fix level:** `Domain` · **Dependencies:** none · **Effort:** S · **Regression risk:** Low.

---
**COLOR-06 — Two parallel project-health color systems**
- **Category:** Duplication · **Severity:** P2 · **Frequency:** 2 files, same thresholds.
- **Evidence:** `lib/project-health.ts:138-157` (`getHealthColor/BgColor/BorderColor`, 4-tier red/yellow/green/**emerald**) vs `components/projects/project-health-badge.tsx:20 getHealthConfig` (same 40/70/90 tiers re-derived).
- **User impact:** Two "positive" greens (green=good, emerald=excellent) muddy the scale; changes must be duplicated.
- **Recommended fix:** single health module; drop the second green (use one positive token + intensity).
- **Fix level:** `Shared component` · **Dependencies:** DS-01 · **Effort:** S · **Regression risk:** Low.

---
**COLOR-07 — Status values collapsed onto one Badge variant (visually indistinct)**
- **Category:** Color · **Severity:** P2 · **Frequency:** 2 surfaces.
- **Evidence:** `dashboard/page.tsx:102-104` maps IN_PROGRESS, REVIEW, DONE all to `variant:'default'`; `epics/page.tsx:34-35` maps IN_PROGRESS and DONE both to `default`.
- **User impact:** Distinct statuses render identically — users can't tell in-progress from done at a glance.
- **Recommended fix:** map each status to a distinct semantic token via the shared status config (COLOR-02).
- **Fix level:** `Domain` · **Dependencies:** COLOR-02 · **Effort:** S · **Regression risk:** Low.

---
**COLOR-08 — 912 raw palette classes across 56 files; status color logic lives in the data layer**
- **Category:** Color / Duplication · **Severity:** P1 · **Frequency:** 912 occurrences / 56 files.
- **Affected (top):** `attendance/attendance-stats.tsx` (51), `lib/leave-utils.ts` (45), `lib/attendance-utils.ts` (45), `hooks/use-team.ts` (45), `attendance/attendance-calendar.tsx` (40), `projects/project-health-card.tsx` (26), `analytics/kpi-widgets.tsx` (22).
- **User impact:** No global control over status color or dark-mode behaviour; role/status color logic in `hooks/use-team.ts:148-160` mixes presentation into the data layer.
- **Root cause:** RC1.
- **Evidence:** family counts — green 178, blue 146, red 132, gray 124, orange 107, yellow 101, purple 60.
- **Recommended fix:** migrate the concentrated domains (attendance/leave/health/team) onto tokens + the semantic modules; move color helpers out of `hooks/` into `lib/semantic/`.
- **Fix level:** `Token` + `Domain` (phased) · **Dependencies:** DS-01, COLOR-01/02 · **Effort:** L · **Regression risk:** Medium (do domain-by-domain with visual checks).

---
**COLOR-09 — Header/global-search defines yet another semantic color map; `labelColorMap` duplicated**
- **Category:** Duplication · **Severity:** P3 · **Frequency:** 3 files.
- **Evidence:** `components/layout/header.tsx:165-180 getTypeColor` (task=blue, project=purple, epic=orange, sprint=green, requirement=pink) — a 6th entity-color scheme; `labelColorMap`+`parseLabel` copy-pasted in `tasks/task-board.tsx:23-41` and `tasks/task-details-dialog.tsx:21-39`.
- **Recommended fix:** entity-color + label-color helpers in `lib/semantic/`.
- **Fix level:** `Shared component` · **Dependencies:** DS-01 · **Effort:** S · **Regression risk:** Low.

### Toast / Feedback & Error Handling (RC3 + RC4)

---
**TOAST-01 — Dual toast systems; the Radix renderer is never mounted → most CRUD feedback is silently dropped**
- **Category:** Toast/Feedback · **Severity:** **P0** · **Frequency:** 9 data hooks + 6 components; nearly all non-task CRUD.
- **Affected:** `hooks/use-project.ts`, `use-sprint.ts`, `use-epic.ts`, `use-leave.ts`, `use-attendance.ts`, `use-notification.ts`, `use-workspace.ts`, `use-client-requirement.ts`, `use-functional-requirement.ts`; `ai/ai-generate-dialog.tsx`, `notifications/notification-center.tsx`, `sprints/fr-assignment-card.tsx`, `requirements/functional-requirement-detail-dialog.tsx`, `sprints/[id]/backlog/page.tsx`, `onboarding/page.tsx`.
- **User impact:** Creating/editing/deleting a project, sprint, epic, leave request, attendance record, requirement, or workspace shows **no success or error toast**. Users can't tell if an action worked or failed. Only `use-task`, `use-admin`, `use-time-entry`, `use-current-workspace` (sonner) actually surface feedback.
- **Root cause:** RC3 — `app/layout.tsx:37` mounts **only** sonner's `<Toaster>`; there is **no `ui/toaster.tsx`** and nothing renders the Radix `use-toast` store (`hooks/use-toast.ts`, `TOAST_REMOVE_DELAY=1000000`).
- **Evidence:** `grep 'use-toast' hooks/` → 9 hooks import `toast` from `@/hooks/use-toast`; `use-project.ts` calls `toast(` at lines 115,121,172,178,198,204,234,270; only `<Toaster/>` in `src` is sonner's (`layout.tsx:37`).
- **Recommended fix:** Standardize on **sonner**. Re-export a sonner-shaped `toast()` from `hooks/use-toast.ts` (map `{title,description,variant}` → `toast.success/error`) so all 15 call sites work immediately; then migrate call sites and delete the Radix `toast.tsx`.
- **Fix level:** `Primitive`/wiring · **Dependencies:** none (do in Wave 1) · **Effort:** M · **Regression risk:** Low (net-new feedback; verify no double toasts where sonner already used).

---
**ERROR-01 — Query/read errors are surfaced nowhere**
- **Category:** Error Handling · **Severity:** P1 · **Frequency:** Every data-fetching page.
- **Affected:** all list/detail pages.
- **User impact:** A failed GET (network/permission/500) shows an **infinite loader or an empty state that looks like "no data"** — users think their data vanished.
- **Root cause:** RC4 — pages read only `isLoading`/`isPending`; `isError`/`error` are never consumed.
- **Evidence:** `isError` = **0 occurrences** repo-wide; error UI appears only in mutation `onError → toast` paths.
- **Recommended fix:** shared `<ErrorState onRetry>` component; adopt in the page-state contract (LOAD-01); optional React Query `throwOnError` + `error.tsx` boundaries (ERROR-02).
- **Fix level:** `Shared component` + `Page` · **Dependencies:** LOAD-01 · **Effort:** M · **Regression risk:** Low.

---
**ERROR-02 — No route-level `error.tsx` / `global-error.tsx` / `not-found.tsx`**
- **Category:** Error Handling · **Severity:** P1 · **Frequency:** Whole app.
- **User impact:** A render error or bad URL drops the user to **Next.js's unstyled default** error/404 — off-brand and dead-ends the flow.
- **Evidence:** file scan of `app/**` shows only `layout.tsx`/`page.tsx` — no `error`, `global-error`, `loading`, or `not-found` segment files exist.
- **Recommended fix:** add styled `app/(dashboard)/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` using the shared error/empty components.
- **Fix level:** `Shell` · **Dependencies:** ERROR-01 components · **Effort:** S · **Regression risk:** Low.

---
**LOAD-01 — No `Skeleton` primitive; six loading idioms; loaders even differ within one file**
- **Category:** Loading · **Severity:** P1 · **Frequency:** App-wide (`isLoading` 108×, `isPending` 51×).
- **Affected:** all async pages/components.
- **User impact:** Loading feels random — full-page spinner here, plain "Loading…" text there, skeleton elsewhere; content-shape isn't previewed, so perceived performance suffers.
- **Root cause:** RC4 — no shared loading contract and **no `Skeleton` component exists** (`animate-pulse` hand-rolled 8×).
- **Evidence:** idioms = `PageLoader` (9 pages), `border-4 border-t-transparent` spinner (`workspaces:51`, `projects/[projectId]:65`, `tasks:784`, `change-password:373`), `border-b-2` spinner (`activity:45`, analytics tabs), plain text (`requirements:344`, `sprints:170`, `profile:80`), hand-rolled skeleton (`leave:108`); **`change-password` contains three different spinners** (`:171,:373,:348`); `attendance` shows **none**.
- **Recommended fix:** add `Skeleton` primitive; define the rule (initial structured load → skeleton; inline action → button spinner; background refresh → keep content); route bespoke spinners through `PageLoader`/`InlineLoader`.
- **Fix level:** `Primitive` + `Page` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

---
**LOAD-02 — Triple sequential loaders on cold start**
- **Category:** Loading / User Flow · **Severity:** P2 · **Frequency:** Every cold load.
- **User impact:** User sees three *different* loading visuals in a row before content: auth border-spinner → workspace `PageLoader` → the page's own loader.
- **Evidence:** `(dashboard)/layout.tsx:26-31` bespoke border spinner (auth) → `guards/workspace-guard.tsx:22 PageLoader` → page loader.
- **Recommended fix:** unify on one loader visual; collapse guard loading so only one indicator shows.
- **Fix level:** `Shell` · **Dependencies:** LOAD-01 · **Effort:** S · **Regression risk:** Low.

---
**LOAD-03 — Bespoke spinners instead of the shared loaders**
- **Category:** Loading / Duplication · **Severity:** P2 · **Frequency:** ~11 sites (25 `animate-spin`, 14 files import shared loaders).
- **Evidence:** two spinner recipes (`border-4 border-primary border-t-transparent` vs `border-b-2 border-primary`) reimplemented across pages listed in LOAD-01.
- **Recommended fix:** replace with `PageLoader`/`InlineLoader`/`Button` loading.
- **Fix level:** `Page` · **Dependencies:** LOAD-01 · **Effort:** S · **Regression risk:** Low.

---
**LOAD-04 — Loading affordance missing or text-only on some pages**
- **Category:** Loading · **Severity:** P2 · **Frequency:** 2 pages.
- **Evidence:** `profile/page.tsx:80` loading is plain "Loading profile…" text, no spinner; `attendance/page.tsx` has no page-level loading at all.
- **Recommended fix:** apply the page-state contract (skeleton/loader).
- **Fix level:** `Page` · **Dependencies:** LOAD-01 · **Effort:** S · **Regression risk:** Low.

### Empty States (RC2 + RC4)

---
**EMPTY-01 — `EmptyState` used in 2 files; "No Workspace" re-implemented 8× (one without an icon)**
- **Category:** Empty States · **Severity:** P1 · **Frequency:** 20+ bespoke sites.
- **Affected:** almost every list/detail page.
- **User impact:** Empty screens look and read differently everywhere; some lack an icon or a call-to-action, so users don't know what to do next.
- **Root cause:** RC2 — canonical `EmptyState` exists but is barely adopted.
- **Evidence:** `EmptyState` imported only in `projects/page.tsx` + `activity/activity-feed.tsx`; identical "No Workspace Found" hand-rolled on `dashboard:116` (**no icon**), `team:243`, `analytics:80`, `analytics/team:37`, `analytics/workspace:44`, `calendar:125`, `activity:50`, `settings:201`; list empties bespoke on `requirements:345`, `epics:224`, `tasks:802`, `leave:119`, `sprints:383`.
- **Recommended fix:** route all empties through `EmptyState`; add a shared `NoWorkspace` state used by the shell/guard.
- **Fix level:** `Shared component` + `Page` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

---
**EMPTY-02 — Empty-state title typography & wording drift (5+ treatments)**
- **Category:** Typography / Empty States · **Severity:** P2 · **Frequency:** ~10 sites.
- **Evidence:** `text-2xl font-semibold` (dashboard/analytics/settings) vs `text-lg font-semibold` (`sprints:198`) vs `text-lg font-medium` (`leave:124`) vs bare `<p>` (`epics:227`) vs `<CardTitle>` (`workspaces:155`, `tasks:498`); wording drifts ("No epics yet" vs "No Workspace Found").
- **Recommended fix:** subsumed by EMPTY-01 (one component fixes typography + copy tone).
- **Fix level:** `Shared component` · **Dependencies:** EMPTY-01 · **Effort:** S · **Regression risk:** Low.

---
**EMPTY-03 — First-use vs no-results empty states not differentiated**
- **Category:** Empty States / UX · **Severity:** P2 · **Frequency:** All filterable lists.
- **User impact:** After a filter/search returns nothing, users see the same "Create your first X" CTA as a brand-new account — confusing (they *have* data).
- **Evidence:** list pages branch only on `.length===0`, not on "filtered vs truly empty" (`tasks`, `requirements`, `functional-requirements`, `team`).
- **Recommended fix:** `EmptyState` supports two modes (first-use with CTA vs no-results with "Clear filters").
- **Fix level:** `Shared component` + `Page` · **Dependencies:** EMPTY-01 · **Effort:** M · **Regression risk:** Low.

### Layout & Page Structure (RC5)

---
**LAYOUT-01 — `PageHeader` used on 2 of 28 pages; 26 hand-roll headers**
- **Category:** Layout · **Severity:** P1 · **Frequency:** 26 pages.
- **Affected:** every route except `projects` and `team`.
- **User impact:** Title size/weight, description sizing, and primary-action placement change on every page — the app has no consistent "top of page."
- **Root cause:** RC2/RC5.
- **Evidence:** `grep PageHeader src/app` → 2 files; canonical `components/layout/page-header.tsx` unused elsewhere.
- **Recommended fix:** adopt `PageHeader` on all content pages (drives TYPO-01, LAYOUT-02/03).
- **Fix level:** `Shared component` + `Page` · **Dependencies:** TYPO-01 decision · **Effort:** L · **Regression risk:** Low-Medium (mechanical, page-by-page).

---
**LAYOUT-02 — Four page-container idioms; only 2 pages constrain width → full-bleed on wide screens**
- **Category:** Layout / Responsive · **Severity:** P1 · **Frequency:** All pages.
- **User impact:** Content line-length is uncontrolled; on 1440px+ monitors most pages stretch edge-to-edge while `projects`/`team` are capped — the app looks like two different products side by side.
- **Root cause:** RC5 — `(dashboard)/layout.tsx:66 <main class="…px-4 py-5 sm:px-6 lg:px-8">` supplies padding but **no max-width or container**.
- **Evidence:** `max-w-7xl mx-auto` only on `projects:200`, `team:255`; `space-y-6` full-bleed on 14 pages; `container mx-auto py-6` on 6 pages; `flex-1 p-8 pt-6` on `attendance:25`.
- **Recommended fix:** introduce a `PageContainer` (or add `max-w-*/mx-auto` to `<main>`); remove per-page containers.
- **Fix level:** `Shell` · **Dependencies:** none · **Effort:** M · **Regression risk:** Medium (shifts every page's width — visual-test).

---
**LAYOUT-03 — Doubled padding on `container`/`p-8` pages**
- **Category:** Spacing · **Severity:** P2 · **Frequency:** 7 pages.
- **User impact:** Analytics/calendar/activity/settings/attendance have visibly larger, uneven outer padding than the rest.
- **Evidence:** layout already applies `px-4 py-5 sm:px-6 lg:px-8` (`layout.tsx:66`), yet those pages add `container … py-6` or `p-8` on top.
- **Recommended fix:** remove per-page outer padding once `PageContainer` owns it.
- **Fix level:** `Shell` + `Page` · **Dependencies:** LAYOUT-02 · **Effort:** S · **Regression risk:** Low.

---
**LAYOUT-04 — No shared toolbar/filter/search abstraction; toolbar structure varies**
- **Category:** Layout · **Severity:** P2 · **Frequency:** All list pages.
- **User impact:** Filters live in a Card on one page, a bare flex row on another; the project selector appears top-right, inline, or in a standalone card; search-icon offsets differ (`left-3 top-1/2` vs `left-2 top-2.5` vs `left-3 top-3`).
- **Evidence:** filter block bordered Card (`requirements:281`, `team:307`) vs `bg-card p-3` strip (`projects:209`) vs bare flex (`tasks:522`); search offsets `projects:211` vs `requirements:289` vs `functional-requirements:323`.
- **Recommended fix:** `PageToolbar` + `SearchInput` + `FilterBar` shared components.
- **Fix level:** `Shared component` + `Page` · **Dependencies:** SIZE-01 · **Effort:** M · **Regression risk:** Low.

---
**LAYOUT-05 — `attendance` page is a structural outlier**
- **Category:** Layout · **Severity:** P2 · **Frequency:** 1 page (but high-traffic).
- **Evidence:** `attendance/page.tsx:25,28` uses `flex-1 p-8 pt-6` container and an **`<h2>`** title (every other page uses `<h1>`), and has no page-level loading/empty/error.
- **Recommended fix:** migrate to `PageContainer` + `PageHeader` + page-state contract.
- **Fix level:** `Page` · **Dependencies:** LAYOUT-01/02, LOAD-01 · **Effort:** S · **Regression risk:** Low.

### Typography (RC5)

---
**TYPO-01 — Page-title typography forks four ways**
- **Category:** Typography · **Severity:** P1 · **Frequency:** All pages.
- **User impact:** The single most-repeated element — the page title — is `semibold` on 2 pages, `bold` on 21, sometimes with an inline icon, once as an `<h2>`.
- **Evidence:** `PageHeader` `text-2xl font-semibold tracking-tight sm:text-3xl` (2 pages) vs `text-3xl font-bold tracking-tight` (13 pages: `requirements:171`, `epics:141`, `tasks:515`, `dashboard:129`…) vs `text-3xl font-bold flex items-center gap-2` + inline `Icon h-8 w-8` (6 pages: `analytics:99`, `calendar:142`, `settings:217`…) vs `<h2>` (`attendance:28`).
- **Recommended fix:** one decision baked into `PageHeader`; adopt via LAYOUT-01.
- **Fix level:** `Shared component` · **Dependencies:** LAYOUT-01 · **Effort:** S (then migration) · **Regression risk:** Low.

---
**TYPO-02 — `CardTitle` is `text-2xl` (too heavy for dense cards)**
- **Category:** Typography · **Severity:** P2 · **Frequency:** Every Card.
- **User impact:** Stat-card and section-card titles compete with page titles; visual hierarchy flattens on data-dense dashboards.
- **Evidence:** `components/ui/card.tsx:26` `text-2xl font-semibold`.
- **Recommended fix:** reduce default `CardTitle` to `text-base`/`text-lg`; opt into larger where a card is a hero stat.
- **Fix level:** `Primitive` · **Dependencies:** none · **Effort:** S · **Regression risk:** Medium (touches all cards — visual-test).

---
**TYPO-03 — Off-scale font sizes; KPI value sizes diverge**
- **Category:** Typography · **Severity:** P3 · **Frequency:** ~9 sites.
- **Evidence:** `text-[10px]` (`sprint-board.tsx:76,218,292`, `attendance-calendar.tsx:286`, `command-palette.tsx:381`), `text-[11px]` (`team:426`); KPI values `text-2xl font-bold` mostly but `text-2xl font-semibold` (`team:290`) and `text-lg font-bold` (`analytics/workspace:205`).
- **Recommended fix:** replace bracket sizes with `text-xs`; standardize a `StatCard` value size.
- **Fix level:** `Shared component`/`Page` · **Dependencies:** DS-05 · **Effort:** S · **Regression risk:** Low.

### Sizing (RC6)

---
**SIZE-01 — Form controls (`h-10`) don't match Button (`h-9`)**
- **Category:** Sizing · **Severity:** P2 · **Frequency:** Every toolbar/form row with a button beside an input.
- **User impact:** Search input + button, or select + button, are misaligned by 4px everywhere.
- **Evidence:** `input.tsx:12` `h-10`, `select.tsx:17` `h-10`, but `button.tsx:24` default `h-9`.
- **Recommended fix:** pick one control height (recommend `h-9` to match Button, or bump Button to `h-10`); align across Input/Select/Button/Textarea.
- **Fix level:** `Primitive` · **Dependencies:** none · **Effort:** S · **Regression risk:** Medium (global control height — visual-test).

---
**SIZE-02 — Dialog width scale is arbitrary; peers diverge**
- **Category:** Sizing / Dialogs · **Severity:** P2 · **Frequency:** ~20 dialogs.
- **User impact:** Equivalent dialogs open at different widths; the create/edit experience feels ad-hoc.
- **Evidence:** `max-w-md` (ManualTime) → `max-w-lg` (Invite, Leave) → `sm:max-w-[500px]` (Clone, the only px unit) → `max-w-2xl` (7) → `max-w-3xl` (CreateFR, TaskDetails) → `max-w-4xl` (detail dialogs) → `max-w-6xl` (AIGenerate). CreateClientRequirement (`2xl`) vs CreateFunctionalRequirement (`3xl`); InviteMember (`lg`) vs sibling creates (`2xl`).
- **Recommended fix:** a `size` prop on `DialogContent` (`sm=max-w-md`, `md=max-w-lg`, `lg=max-w-2xl`, `xl=max-w-4xl`); map dialogs by content complexity.
- **Fix level:** `Primitive` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

---
**SIZE-03 — Arbitrary widths for equivalent controls**
- **Category:** Sizing · **Severity:** P3 · **Frequency:** ~12 sites.
- **Evidence:** filter/select widths `w-[250px]` (`analytics:487`, `activity:88`), `w-[200px]` (`sprints:223`, `calendar:149`), `w-[180px]`, `w-[120px]`, `w-[400px]/[450px]`; loader containers `min-h-[400px]` repeated 4×.
- **Recommended fix:** standard filter width token/util; shared loading-container height.
- **Fix level:** `Shared component` · **Dependencies:** LAYOUT-04 · **Effort:** S · **Regression risk:** Low.

---
**SIZE-04 — Card padding fixed at `p-6`, no density option**
- **Category:** Sizing · **Severity:** P3 · **Frequency:** Every Card.
- **Evidence:** `card.tsx:17,43,50` all `p-6`; DS-04 compact mode can't reliably shrink it.
- **Recommended fix:** density-aware padding via token; optional `compact` card.
- **Fix level:** `Primitive` · **Dependencies:** DS-04 · **Effort:** S · **Regression risk:** Low.

### Dialogs & Overlays

---
**DIALOG-01 — `DialogFooter` lacks `justify-end`; footer alignment drifts**
- **Category:** Dialogs · **Severity:** P2 · **Frequency:** All dialogs using the base footer.
- **User impact:** Footer buttons **left-align** on desktop in ~6 dialogs and right-align in others; `EditTask` locally patched it — proof the default is wrong.
- **Evidence:** `dialog.tsx:62` `flex flex-col-reverse sm:flex-row sm:space-x-2` (no `justify-end`); left-align in CreateProject/CreateTask/CreateSprint/Invite/LeaveRequest/ManualTime; `edit-task-dialog.tsx:449` adds `justify-end`; 4 dialogs use raw `<div className="flex justify-end">` footers (`create-epic:203`, `create-client-requirement:167`, `create-functional-requirement:335`, `ai-generate:344`).
- **Recommended fix:** add `sm:justify-end` to `DialogFooter`; replace raw-div footers with `<DialogFooter>`.
- **Fix level:** `Primitive` · **Dependencies:** none · **Effort:** S · **Regression risk:** Low.

---
**DIALOG-02 — No `Sheet` primitive; every overlay is a Dialog regardless of fit**
- **Category:** Dialogs · **Severity:** P2 · **Frequency:** App-wide.
- **User impact:** Long/secondary flows (detail panels, AI generation at `max-w-6xl`, filter-heavy edits) are forced into centered modals; no side-panel pattern for contextual work; no mobile-appropriate bottom sheet.
- **Evidence:** no `sheet.tsx` in `components/ui`; AIGenerate crammed into a `max-w-6xl` Dialog; detail dialogs at `max-w-4xl`.
- **Recommended fix:** add shadcn `Sheet`; define usage (Dialog = short focused; Sheet = contextual/long; AlertDialog = destructive; Popover = lightweight).
- **Fix level:** `Primitive` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

### Forms

---
**FORM-01 — Validation approach split (RHF+zod vs manual `useState`), even for the same entity**
- **Category:** Forms · **Severity:** P2 · **Frequency:** ~18 forms.
- **User impact:** Validation timing and error presentation differ per form; some validate on submit, some on change; some show field errors, some only block submit.
- **Evidence:** RHF+zod (CreateTask/Epic/Sprint/FR, EditProject/Task, AIGenerate) vs manual useState (CreateProject, Invite, LeaveRequest, ManualTime); **CreateProject manual vs EditProject zod**; `create-client-requirement-dialog.tsx:54` validates 3 fields with zod but leaves `priority` in unvalidated `useState`.
- **Recommended fix:** standardize create/edit dialogs on RHF+zod + `Form` primitives; shared zod schemas per entity.
- **Fix level:** `Domain` · **Dependencies:** none · **Effort:** L · **Regression risk:** Medium (touches form logic — test each).

---
**FORM-02 — Field composition ~50/50 shared `Form` primitives vs raw HTML**
- **Category:** Forms / Duplication · **Severity:** P2 · **Frequency:** ~18 forms.
- **Evidence:** raw `<Label>`/`<Input>` in CreateProject, Clone, Invite, LeaveRequest, ManualTime, CreateClientReq, all Settings/Profile, all detail dialogs; `Form`/`FormField` in the RHF set. Profile edit has **no `<form>` element**.
- **User impact:** Inconsistent label spacing, error slots, and keyboard/`aria` wiring; raw forms lose `FormMessage` accessibility.
- **Recommended fix:** migrate to `Form`/`FormField`; wrap Profile/Settings in `<form>`.
- **Fix level:** `Domain` · **Dependencies:** FORM-01 · **Effort:** L · **Regression risk:** Medium.

---
**FORM-03 — Submit loading-guard inconsistent; two double-submit risks**
- **Category:** Forms · **Severity:** P1 · **Frequency:** ~18 forms.
- **User impact:** Some submits show a spinner, most only change text, one shows a spinner but never changes its label; **two forms can be submitted twice** (duplicate records).
- **Evidence:** proper spinner+disabled (Clone, CreateTask, AddMembers, Profile); text-only (most); `create-sprint-dialog.tsx:243` spinner without label change; **double-submit:** `client-requirement-detail-dialog.tsx:300` guards only on `!hasChanges` (no pending), `ai-generate-dialog.tsx:348` submit has no disabled state.
- **Recommended fix:** add a `loading` prop to `Button` (spinner + auto-disable); apply to every submit; disable while `isPending`.
- **Fix level:** `Primitive` + `Domain` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

---
**FORM-04 — Cancel-button disabling during pending is inconsistent**
- **Category:** Forms · **Severity:** P3 · **Frequency:** ~18 forms.
- **Evidence:** `ManualTime` disables Cancel while pending; most dialogs leave it enabled (can close mid-mutation).
- **Recommended fix:** standard dialog-form footer behavior (disable both while pending, or allow cancel-to-abort consistently).
- **Fix level:** `Domain` · **Dependencies:** FORM-03 · **Effort:** S · **Regression risk:** Low.

---
**FORM-05 — `NotificationPreferences` persists to `localStorage`, not the backend**
- **Category:** Forms / User Flow · **Severity:** P1 · **Frequency:** 1 surface (but data-integrity).
- **User impact:** Notification settings silently don't sync across devices/sessions and look saved when they aren't durably persisted server-side.
- **Evidence:** `components/settings/notification-preferences.tsx:155` writes to `localStorage`, toasts success via sonner.
- **Recommended fix:** wire to the settings API; keep localStorage only as cache. (Flagged as UX-critical; confirm backend endpoint exists.)
- **Fix level:** `Domain` · **Dependencies:** API · **Effort:** M · **Regression risk:** Low.

### Destructive Flows

---
**DESTRUCT-01 — Destructive confirmation is not standardized; some destructive actions have none**
- **Category:** Destructive Flow · **Severity:** **P0** · **Frequency:** ~8 destructive actions.
- **User impact:** Irreversible actions fire with **zero confirmation**, risking data loss:
  - **Clear All Notifications bulk-deletes everything immediately** (`notifications/notification-center.tsx:209,360-370`).
  - Delete single notification immediate (`:204`); Remove FR from sprint immediate (`backlog:145`); Unassign member from FR immediate (`fr-assignment-card:120`); Start/Complete Sprint immediate (`sprints/page.tsx:132,136`).
  - Delete Sprint uses **native `window.confirm()`** (`sprints/page.tsx:122`) — the only native confirm, unstyled and jarring.
- **Root cause:** No shared `useConfirm()`/confirm pattern; AlertDialog adopted unevenly.
- **Recommended fix:** a `useConfirm()` hook / `<ConfirmDialog>` wrapper; require confirmation for every destructive/irreversible action; replace `window.confirm`.
- **Fix level:** `Shared component` + `Domain` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

---
**DESTRUCT-02 — Delete-confirmation styling inconsistent (confirm button not always red)**
- **Category:** Destructive Flow · **Severity:** P2 · **Frequency:** ~10 AlertDialogs.
- **User impact:** The "Delete Task" confirm button is a **default primary (non-red) button**, so the most-used delete doesn't read as dangerous; other deletes use `bg-destructive`, and Delete-Workspace uses `bg-red-600`.
- **Evidence:** `tasks/page.tsx:857` (non-red `AlertDialogAction`) vs `bg-destructive` (projects/workspaces/epic/FR/client-req) vs `bg-red-600` (`delete-workspace-dialog.tsx:101`). Footer alignment also splits (`sm:justify-between` in some, `justify-end` in others).
- **Recommended fix:** `AlertDialogAction` destructive variant by default for delete flows; one footer layout.
- **Fix level:** `Primitive` + `Domain` · **Dependencies:** DS-01 · **Effort:** S · **Regression risk:** Low.

---
**DESTRUCT-03 — Reject-Leave uses a plain `Dialog` instead of `AlertDialog`**
- **Category:** Destructive Flow · **Severity:** P3 · **Frequency:** 1 surface.
- **Evidence:** `leave/leave-approval-card.tsx:229` reject flow is a `Dialog` (footer `sm:justify-between`), inconsistent with the approve action and other confirmations; approve submit is hardcoded `bg-green-600` (`:205`).
- **Recommended fix:** use `AlertDialog` for reject; token-based colors for approve.
- **Fix level:** `Domain` · **Dependencies:** DS-01 · **Effort:** S · **Regression risk:** Low.

### Navigation & Information Architecture

---
**NAV-01 — Sidebar is a flat list (section groups are comments); several routes are undiscoverable**
- **Category:** Navigation/IA · **Severity:** P1 · **Frequency:** Global.
- **User impact:** 13 nav items in one ungrouped column; **Leave (`/leave`), Workspaces (`/workspaces`), `/analytics/team`, `/analytics/workspace`, `/attendance/team` are not in the nav at all** — reachable only by deep link, so major features are effectively hidden.
- **Evidence:** `components/layout/sidebar.tsx:34-120` — section headings ("Overview", "Configuration") exist **only as code comments**; `navigation` array omits the routes above.
- **Recommended fix:** render visual nav groups; add missing destinations (or intentionally nest them, e.g. Leave under Attendance) with clear labels.
- **Fix level:** `Shell` · **Dependencies:** NAV-04 (analytics IA) · **Effort:** M · **Regression risk:** Low.

---
**NAV-02 — Two separate global-search systems**
- **Category:** Navigation · **Severity:** P2 · **Frequency:** Global.
- **User impact:** A header search dropdown and a Cmd+K command palette are separate implementations with different result rendering — duplicated logic and inconsistent search UX.
- **Evidence:** `components/layout/header.tsx:225-364` bespoke search dropdown (300ms debounce, click-outside) + `components/search/command-palette.tsx` (Cmd+K) mounted in `(dashboard)/layout.tsx:49`.
- **Recommended fix:** make the header search open the command palette (single source), or share the result renderer.
- **Fix level:** `Shell`/`Domain` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

---
**NAV-03 — Sidebar internals: imperative CSS-var mutation, flash-of-expanded, nested `TooltipProvider`, bespoke avatar**
- **Category:** Navigation / Interaction · **Severity:** P2 · **Frequency:** Global.
- **Evidence:** `sidebar.tsx:143-155` sets `document.documentElement.style.setProperty('--sidebar-width', …)` imperatively; collapsed state loaded from `localStorage` after first paint → **flash of expanded sidebar**; `sidebar.tsx:159` mounts a **second** `TooltipProvider` (one already in `(dashboard)/layout.tsx:43`); sidebar uses a bespoke gradient-circle avatar (`:243`) while the header uses the `Avatar` primitive.
- **Recommended fix:** drive width from React state/context and persist without post-paint flash; single `TooltipProvider`; use `Avatar` in the sidebar.
- **Fix level:** `Shell` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low-Medium.

---
**NAV-04 — Redundant/overlapping analytics surfaces; two are orphaned**
- **Category:** Navigation/IA · **Severity:** P2 · **Frequency:** 3 analytics routes + dashboard + sprint analytics.
- **User impact:** `/analytics` already contains **workspace + team + project tabs**, yet standalone `/analytics/team` and `/analytics/workspace` pages duplicate that data and are **not linked from the nav** — users can't find them and, if they do, see the same thing twice.
- **Evidence:** `analytics/page.tsx` Tabs (`?view=`) vs `analytics/team/page.tsx` (284 lines) + `analytics/workspace/page.tsx` (308 lines), neither in `sidebar.tsx` `navigation`.
- **Recommended fix:** decide one IA — either make the tabs deep-linkable and delete the standalone pages, or make the standalone pages the canonical targets and link them. Preserve any unique widgets.
- **Fix level:** `Domain`/IA · **Dependencies:** none · **Effort:** M · **Regression risk:** Medium (route changes — add redirects).

---
**NAV-05 — Mobile navigation uses a `DropdownMenu` (off-pattern) and inherits the missing routes**
- **Category:** Navigation / Responsive · **Severity:** P2 · **Frequency:** Mobile (<768px).
- **Evidence:** `header.tsx:196-222` renders primary nav as a `DropdownMenu` from the same flat `navigation` array (so it also lacks Leave/Workspaces); no `Sheet` drawer.
- **Recommended fix:** mobile nav as a `Sheet` mirroring the grouped sidebar (depends on DIALOG-02, NAV-01).
- **Fix level:** `Shell` · **Dependencies:** DIALOG-02, NAV-01 · **Effort:** M · **Regression risk:** Low.

### Tables & Boards

---
**TABLE-01 — `functional-requirements` hand-rolls a `<table>` instead of the shared `Table`**
- **Category:** Tables / Duplication · **Severity:** P2 · **Frequency:** 1 page (diverges from siblings).
- **Evidence:** `functional-requirements/page.tsx:378` raw `<table class="w-full">` with `<th class="p-4">` vs the `Table` primitive (`TableHead h-12 px-4`) used by `requirements/page.tsx:362` and `team/page.tsx:371`; no `overflow-auto` wrapper, no responsive column hiding.
- **Recommended fix:** convert to the `Table` primitive.
- **Fix level:** `Page` · **Dependencies:** none · **Effort:** S · **Regression risk:** Low.

---
**TABLE-02 — No pagination anywhere; all rows always rendered**
- **Category:** Tables / Performance · **Severity:** P2 · **Frequency:** Every table.
- **User impact:** Large teams/requirement lists render unbounded DOM — slow scroll, no way to page; a data-dense enterprise app with no pagination.
- **Evidence:** no `Pagination` component; every table `.map()`s the full filtered array; pagination exists only in `lib/api/*`.
- **Recommended fix:** add a `Pagination`/`DataTable` with client or server paging; wire the existing API paging.
- **Fix level:** `Shared component` · **Dependencies:** LAYOUT-04 · **Effort:** L · **Regression risk:** Medium.

---
**TABLE-03 — Table empty-state and row-click affordances differ**
- **Category:** Tables · **Severity:** P3 · **Frequency:** 3 tables.
- **Evidence:** empty state = in-table `colSpan` row (`team:386`) vs separate pre-table block (`requirements:357`) vs none (FR page); rows clickable in requirements/FR but not team.
- **Recommended fix:** one `DataTable` contract (empty row + optional `onRowClick`).
- **Fix level:** `Shared component` · **Dependencies:** TABLE-01/02 · **Effort:** M · **Regression risk:** Low.

---
**BOARD-01 — Two bespoke Kanban boards; no shared abstraction; divergent columns/colors/behavior**
- **Category:** Boards / Duplication · **Severity:** P1 · **Frequency:** 2 boards (core workflow).
- **User impact:** Task board and sprint board look and behave differently — 5 columns vs 4, different column colors (IN_PROGRESS yellow vs blue — see COLOR-02), different drag feedback, different empty columns, priority shown as border+dot+label vs a bare dot; the drag/drop code is duplicated.
- **Evidence:** `tasks/task-board.tsx` (`grid …xl:grid-cols-5 gap-4`, `bg-*-100/900`, `border-l-4` priority, dropdown actions) vs `sprints/sprint-board.tsx` (`lg:grid-cols-4`, `bg-*-50/950`, `rotate-2` on drag, dot only, no actions); `handleDragEnd` logic duplicated.
- **Recommended fix:** extract a configurable `<Board columns cardRenderer onDragEnd>`; drive columns/colors from the shared status config; keep task-vs-FR data differences as props.
- **Fix level:** `Shared component` · **Dependencies:** COLOR-02 · **Effort:** L · **Regression risk:** Medium (core interaction — test drag/drop + realtime).

### Accessibility

---
**A11Y-01 — `prefers-reduced-motion` is not honored**
- **Category:** Accessibility / Animation · **Severity:** P1 · **Frequency:** App-wide.
- **User impact:** Users with vestibular sensitivity get all animations (page-header slide-in, dialog zoom, hover transforms) regardless of OS setting; only a manual Settings toggle exists.
- **Evidence:** `grep prefers-reduced-motion src` → **none**; `globals.css` has a manual `.no-animations` class only; `PageHeader` uses `animate-in slide-in-from-bottom-2 duration-500`.
- **Recommended fix:** global `@media (prefers-reduced-motion: reduce)` that neutralizes transitions/animations; wire the Settings toggle to also respect OS default.
- **Fix level:** `Token`/global CSS · **Dependencies:** none · **Effort:** S · **Regression risk:** Low.

---
**A11Y-02 — Status/badge color contrast failures (light & dark)**
- **Category:** Accessibility / Color · **Severity:** P1 · **Frequency:** Badge + status text app-wide.
- **User impact:** `warning` badge (white on `yellow-500`) and various `text-*-500` on tinted backgrounds fall below WCAG AA; some dark-mode status text is low-contrast.
- **Evidence:** `badge.tsx:15`; widespread `text-*-500`/`bg-*-100` pairings (COLOR-08).
- **Recommended fix:** token foregrounds chosen for contrast (DS-01/02); audit status pairings when migrating COLOR-08.
- **Fix level:** `Token`/`Primitive` · **Dependencies:** DS-01/02 · **Effort:** M · **Regression risk:** Low.

---
**A11Y-03 — Icon-only controls & focus states need verification/hardening**
- **Category:** Accessibility · **Severity:** P2 · **Frequency:** Several controls.
- **User impact:** Some icon-only buttons rely on the primitive's focus ring but lack `aria-label` (header theme/menu buttons have `sr-only` labels — good — but the sidebar collapse toggle `sidebar.tsx:256-263` and some card menu triggers do not); keyboard focus order across custom dropdowns/search should be verified.
- **Evidence:** `sidebar.tsx:256` collapse `Button size="icon"` has no `sr-only`/`aria-label`; mixed usage elsewhere.
- **Recommended fix:** audit all `size="icon"` buttons for accessible names; verify focus-visible rings survive any color changes.
- **Fix level:** `Domain` · **Dependencies:** none · **Effort:** M · **Regression risk:** Low.

### Animation / Interaction

---
**ANIM-01 — No motion system; durations and hover treatments are ad-hoc**
- **Category:** Animation / Interaction · **Severity:** P3 · **Frequency:** App-wide.
- **User impact:** Durations range `duration-200/300/500` with no rationale; some cards lift on hover, others don't; some dropdowns animate, others snap.
- **Evidence:** `PageHeader duration-500`, sidebar `transition-all duration-300`, layout `transition-[padding] duration-300`, various `hover:` transforms; no documented scale.
- **Recommended fix:** motion tokens (micro 100–150ms, standard 150–200ms, overlay 200–300ms) in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); apply consistently; pair with A11Y-01.
- **Fix level:** `Token`/docs · **Dependencies:** A11Y-01 · **Effort:** M · **Regression risk:** Low.

---
**INTERACT-01 — Inconsistent mutation feedback & optimistic-update behavior**
- **Category:** Interaction · **Severity:** P2 · **Frequency:** Boards/lists.
- **User impact:** Task board updates via realtime + parent callback; sprint board uses local optimistic state + inline mutations → different latency/rollback behavior for the "same" drag action; combined with TOAST-01, many mutations give no confirmation.
- **Evidence:** `task-board.tsx:126` `useTasksRealtime` + `onTaskMove` vs `sprint-board.tsx:127` local optimistic state.
- **Recommended fix:** consistent mutation pattern (optimistic + toast + rollback) once TOAST-01 is fixed and BOARD-01 unifies boards.
- **Fix level:** `Domain` · **Dependencies:** TOAST-01, BOARD-01 · **Effort:** M · **Regression risk:** Medium.

### User Flow

---
**FLOW-01 — Client-side auth redirects cause flashes**
- **Category:** User Flow · **Severity:** P2 · **Frequency:** Auth/entry.
- **User impact:** Redirects run in `useEffect` after render, so users briefly see a spinner/blank before being sent to `/login` or `/onboarding`.
- **Evidence:** `(dashboard)/layout.tsx:20-24` and `guards/workspace-guard.tsx:14-20` push routes in `useEffect`; combines with LOAD-02.
- **Recommended fix:** consolidate guard loading; consider middleware-level redirect for unauthenticated users to remove the flash.
- **Fix level:** `Shell` · **Dependencies:** LOAD-02 · **Effort:** M · **Regression risk:** Medium.

---
**FLOW-02 — AI-generation flow gives no feedback on its key steps (compounded by TOAST-01)**
- **Category:** User Flow · **Severity:** P1 · **Frequency:** AI generation.
- **User impact:** The multi-step generate→review→bulk-save flow relies on `useToast` (dead) for success/error and its submit button has no disabled state — users get no confirmation and can double-trigger.
- **Evidence:** `ai/ai-generate-dialog.tsx:178,234` toast via dead `useToast`; `:348` submit not disabled.
- **Recommended fix:** fix via TOAST-01 + FORM-03; add explicit step status UI for the long parse/generate operations.
- **Fix level:** `Domain` · **Dependencies:** TOAST-01, FORM-03 · **Effort:** M · **Regression risk:** Low.

### Responsive & Dark Mode

---
**RESP-01 — Full-bleed pages + arbitrary widths degrade wide and narrow layouts**
- **Category:** Responsive · **Severity:** P2 · **Frequency:** Most pages.
- **User impact:** On ultrawide, unconstrained pages sprawl; on mobile, fixed `w-[400px]`/`min-w-[640px]` blocks and dense tables overflow.
- **Evidence:** LAYOUT-02 (no max-width), SIZE-03 (fixed widths), TABLE-01 (no overflow wrapper on FR table), `team/page.tsx:371` `min-w-[640px]`.
- **Recommended fix:** `PageContainer` max-width + fluid filter widths + tables in `overflow-x-auto`; verify at 320/375/768/1024/1440/1920.
- **Fix level:** `Shell` + `Page` · **Dependencies:** LAYOUT-02, SIZE-03 · **Effort:** M · **Regression risk:** Medium.

---
**DARK-01 — Dark-mode status colors are hand-tuned per file (inconsistent)**
- **Category:** Dark Mode · **Severity:** P2 · **Frequency:** Everywhere status color appears.
- **User impact:** Because status colors bypass tokens (COLOR-08), dark-mode variants are added ad-hoc (`dark:bg-*-950/30`, `dark:text-*-400`) and some pairings are low-contrast or missing.
- **Evidence:** `project-health.ts:138-157` dark variants per function; 56 files with raw palette + scattered `dark:` overrides.
- **Recommended fix:** tokens carry their own dark values (DS-01) so components stop hand-writing `dark:` for status.
- **Fix level:** `Token` · **Dependencies:** DS-01, COLOR-08 · **Effort:** M · **Regression risk:** Low.

---

## 6. Consistency matrix (Phase 25)

Legend: ✅ consistent/shared · ⚠️ partial/varies · ❌ divergent/bespoke · — n/a.

| Pattern | Projects | Requirements | Functional Reqs | Epics | Tasks | Sprints | Team | Attendance | Leave | Analytics | Consistent? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Uses `PageHeader` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ (`h2`) | ❌ | ❌ (+icon) | ❌ |
| Title type | `2xl→3xl semibold` | `3xl bold` | `3xl bold` | `3xl bold` | `3xl bold` | `3xl bold` | `2xl→3xl semibold` | `3xl bold h2` | `3xl bold` | `3xl bold+icon` | ❌ |
| Page container / max-w | `max-w-7xl` | `space-y-6` | `space-y-6` | `space-y-6` | `space-y-6` | `space-y-6` | `max-w-7xl` | `p-8` | `space-y-6` | `container py-6` | ❌ |
| Primary CTA placement | header actions | header | header | header | inline toolbar | header actions | header actions | widget | header | top-right | ⚠️ |
| Search input | ⚠️ offset A | ⚠️ offset B | ⚠️ offset C | ⚠️ | ⚠️ offset B | — | ⚠️ | — | — | — | ❌ |
| Filters container | `bg-card p-3` | Card | (hand table) | Card | bare flex | header | Card | widget | — | top-right select | ❌ |
| Loading | `PageLoader` | plain text | plain text | plain text | `border-4` | plain text | `PageLoader` | none | skeleton | `PageLoader`+`border-b-2` | ❌ |
| Empty state | `EmptyState` ✅ | bespoke | bespoke | bare `<p>` | `CardTitle` | Card | in-table | none | Card | centered `2xl` | ❌ |
| Error state | none | none | none | none | none | none | none | none | none | none | ✅ (all missing) |
| Status color source | dup map | dup map | dup ×4 | inline | inline | inline | `use-team` | util | ✅ util | mixed | ❌ |
| Priority color source | — | inline | inline | — | inline | inline | — | — | — | — | ❌ (6 maps) |
| Delete flow | AlertDialog | AlertDialog | AlertDialog | AlertDialog | AlertDialog (non-red) | `window.confirm` | AlertDialog | — | (approve/reject) | — | ❌ |
| Dialog width | `2xl` | `2xl` | `3xl` | `2xl` | `2xl` | `2xl` | `lg`/inline | `md` | `2xl` | `6xl` | ❌ |
| Success toast works | ⚠️ hook dead | ❌ dead | ❌ dead | ❌ dead | ✅ sonner | ❌ dead | ✅ sonner | ❌ dead | ❌ dead | ❌ dead | ❌ |
| Form stack | manual/zod mix | register+manual | Form+zod | Form+zod | Form+zod | Form+zod | FormData | manual | manual | Form+zod | ❌ |

**Reading:** the only rows that are "consistent" are the ones where a pattern is *uniformly missing* (error states) or where a lone domain got it right (Leave status color, Task toast). Everything else is ⚠️/❌ — confirming these are systemic, not per-page, problems.

---

## 7. Positive baselines to emulate

These already do it right — the target patterns to propagate:

- **`lib/leave-utils.ts:139 getLeaveStatusColor`** — the one status-color map defined once and imported by both consumers (`leave/page.tsx`, `leave-approval-card.tsx`). Template for the semantic-color module.
- **`components/layout/page-header.tsx`** — a clean, responsive page header; the fix is adoption, not redesign.
- **`components/ui/empty-state.tsx`, `page-loader.tsx`** — good canonical states; adopt broadly.
- **`components/tasks/priority-badge.tsx`** — already models the right config shape; wire it in.
- **`hooks/use-task.ts`** (sonner) — the toast pattern the other hooks should match.
- **Icon sizing** — `h-4 w-4` is a de-facto standard (350 uses); least-broken dimension.
- **`team/page.tsx` table** — best-in-class responsive table (`min-w-0`, `truncate`, `hidden lg/xl:table-cell`); template for `DataTable`.

---

## 8. Metrics appendix

| Metric | Value |
|---|---|
| Route pages | 28 (26 content + 2 redirects) |
| UI primitives | 29 (`components/ui/*`); **missing:** `Skeleton`, `Sheet`, `Toaster` (radix), `Pagination` |
| `PageHeader` adoption | 2 / 28 pages |
| `EmptyState` adoption | 2 files / 4 sites |
| `PriorityBadge` rendered | 0 sites (used only for `.score`) |
| Raw palette classes | **912 across 56 files** (green 178 · blue 146 · red 132 · gray 124 · orange 107 · yellow 101 · purple 60) |
| Hardcoded chart hex | ~23 across 5 files, 2 conflicting palettes |
| Duplicated semantic maps | priority ×6 · FR status ×4 · project status ×2 · requirement status ×2 · attendance ×2 · health ×2 |
| `isError` handling | 0 occurrences |
| Toast systems | 2 (sonner mounted; Radix `useToast` used by 9 hooks + 6 components, **unmounted**) |
| Loading idioms | 6; **0** `Skeleton`, **0** route `loading.tsx` |
| Route boundaries | 0 `error.tsx` / `global-error.tsx` / `not-found.tsx` |
| `prefers-reduced-motion` | not honored |
| Native `window.confirm` | 1 (`sprints/page.tsx:122`) |
| Destructive actions w/o confirmation | ≥5 (incl. bulk "Clear all notifications") |

---

*Next:* see [UI_UX_REMEDIATION_PLAN.md](UI_UX_REMEDIATION_PLAN.md) for the wave-by-wave fix sequence and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the target token/typography/spacing/motion spec. No production UI code is to be modified until these are reviewed.
