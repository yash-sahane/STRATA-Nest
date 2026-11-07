import { toneStyle, type SemanticTone, type BadgeVariant } from './tone';

/**
 * Single source of truth for status display across domains (COLOR-02/03/04/07).
 *
 * Replaces the duplicated inline maps (FR status copy-pasted 4×, project 2×,
 * requirement 2×) and the collapsed-variant cases where distinct statuses
 * rendered identically (dashboard/epics mapped several statuses to one variant).
 *
 * Tone convention (see docs/DESIGN_SYSTEM.md):
 *   neutral      not-started / draft / planning
 *   info         in-progress / approved-but-not-final / completed-project
 *   built        delivered, not yet verified (FR IMPLEMENTED)
 *   verified     checked and passing, not yet released (FR TESTED)
 *   warning      needs-attention: review, on-hold
 *   success      terminal-positive: done, deployed, active-project, present
 *   destructive  rejected / cancelled / blocked
 *
 * Note the deliberate reuse of `success` for both a task's DONE and a project's
 * ACTIVE — disambiguated by context + label, never contradictory on one surface.
 * Reuse WITHIN one lifecycle is a different matter — see FUNCTIONAL_REQUIREMENT_STATUS.
 */
export interface StatusConfig {
  label: string;
  tone: SemanticTone;
  badgeVariant: BadgeVariant;
  /** Pass alongside `badgeVariant`; '' for the token-backed tones. See ToneStyle. */
  badgeClassName: string;
  dot: string;
  border: string;
  /** Left-edge accent only (e.g. a card's leading border). */
  borderLeft: string;
}

const TASK_STATUS: Record<string, SemanticTone> = {
  BACKLOG: 'neutral',
  TODO: 'neutral',
  IN_PROGRESS: 'info',
  REVIEW: 'warning',
  DONE: 'success',
};

const EPIC_STATUS: Record<string, SemanticTone> = {
  TODO: 'neutral',
  IN_PROGRESS: 'info',
  DONE: 'success',
};

/**
 * The FR lifecycle is DRAFT -> REVIEW -> APPROVED -> IMPLEMENTED -> TESTED ->
 * DEPLOYED, and every one of those six is a distinct tone on purpose.
 *
 * APPROVED, IMPLEMENTED and TESTED all used to resolve to `info`, so three
 * consecutive stages painted one identical fill — rgb(16,104,244) in light,
 * rgb(38,108,223) in dark — on the epic dialog, the FR detail dot, the sprint
 * FR card and the status filter alike. A pill exists to be told apart at a
 * glance; reading the label to work out which of three it is defeats it.
 * `built` and `verified` were added to lib/semantic/tone.ts for the two middle
 * stages (contrast measured there).
 *
 * This is the one map where reusing a tone is NOT acceptable: unlike DONE vs
 * ACTIVE, these stages sit next to each other in the same list.
 */
const FUNCTIONAL_REQUIREMENT_STATUS: Record<string, SemanticTone> = {
  DRAFT: 'neutral',
  REVIEW: 'warning',
  APPROVED: 'info',
  IMPLEMENTED: 'built',
  TESTED: 'verified',
  DEPLOYED: 'success',
};

const PROJECT_STATUS: Record<string, SemanticTone> = {
  PLANNING: 'neutral',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'info',
  ARCHIVED: 'neutral',
};

const SPRINT_STATUS: Record<string, SemanticTone> = {
  PLANNING: 'neutral',
  ACTIVE: 'success',
  COMPLETED: 'info',
};

const REQUIREMENT_STATUS: Record<string, SemanticTone> = {
  DRAFT: 'neutral',
  // Awaiting a decision — "needs attention", same tone as REVIEW elsewhere.
  SUBMITTED: 'warning',
  APPROVED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  ARCHIVED: 'neutral',
};

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A stored enum value as people read it: `IN_PROGRESS` -> "In Progress".
 *
 * For the places that print a status or a type with no tone to go with it. They
 * each did their own `.replace('_', ' ')`, which left the value in capitals
 * ("IN PROGRESS") beside badges elsewhere that said "In Progress" — and, with
 * the non-global form, only ever replaced the FIRST underscore.
 */
export function humanizeEnum(value: string | null | undefined): string {
  return value ? titleCase(String(value)) : '';
}

/** Time entries move PENDING -> APPROVED | REJECTED, owned by the API's
 *  approve/reject endpoints (self-approval is refused server-side). */
const TIME_ENTRY_STATUS: Record<string, SemanticTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

/**
 * What a functional requirement's stored status MEANS, in the words a person
 * would use. The stored names are a lifecycle nobody operates: nothing here
 * approves, implements, tests or deploys a requirement. The status is worked
 * out from its tasks, so "Approved" was "has tasks, none started" — Ready, not
 * "Planned", which it read while listed under "Not in a Sprint" — "Implemented"
 * was "a task is in progress" — work still being built — and "Tested" was "every
 * task is done". "Deployed" is the one a person sets, by signing the
 * requirement off. The stored values are unchanged; this is only what is shown.
 */
const FUNCTIONAL_REQUIREMENT_LABELS: Record<string, string> = {
  APPROVED: 'Ready',
  IMPLEMENTED: 'In Progress',
  TESTED: 'Tasks Done',
  DEPLOYED: 'Done',
};

/** `TODO` title-cases to "Todo", beside columns and tiles that say "To Do". */
const TODO_LABEL: Record<string, string> = { TODO: 'To Do' };

function makeResolver(map: Record<string, SemanticTone>, labels: Record<string, string> = {}) {
  return (status: string | null | undefined): StatusConfig => {
    const key = String(status ?? '').toUpperCase();
    const tone = map[key] ?? 'neutral';
    const style = toneStyle[tone];
    return {
      label: labels[key] ?? titleCase(key || 'Unknown'),
      tone,
      badgeVariant: style.badgeVariant,
      badgeClassName: style.badgeClassName,
      dot: style.dot,
      border: style.border,
      borderLeft: style.borderLeft,
    };
  };
}

/**
 * Ordered status keys per domain — use these to build filter dropdowns instead
 * of re-listing statuses inline (which is how the duplicated maps started).
 */
export const TASK_STATUSES = Object.keys(TASK_STATUS);
export const EPIC_STATUSES = Object.keys(EPIC_STATUS);
export const FUNCTIONAL_REQUIREMENT_STATUSES = Object.keys(FUNCTIONAL_REQUIREMENT_STATUS);
export const PROJECT_STATUSES = Object.keys(PROJECT_STATUS);
export const SPRINT_STATUSES = Object.keys(SPRINT_STATUS);
export const REQUIREMENT_STATUSES = Object.keys(REQUIREMENT_STATUS);

export const getTaskStatusConfig = makeResolver(TASK_STATUS, TODO_LABEL);
export const getEpicStatusConfig = makeResolver(EPIC_STATUS, TODO_LABEL);
export const getFunctionalRequirementStatusConfig = makeResolver(
  FUNCTIONAL_REQUIREMENT_STATUS,
  FUNCTIONAL_REQUIREMENT_LABELS,
);
export const getProjectStatusConfig = makeResolver(PROJECT_STATUS);
export const getSprintStatusConfig = makeResolver(SPRINT_STATUS);
export const getRequirementStatusConfig = makeResolver(REQUIREMENT_STATUS);
export const getTimeEntryStatusConfig = makeResolver(TIME_ENTRY_STATUS);
