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
 *   warning      needs-attention: review, on-hold
 *   success      terminal-positive: done, deployed, active-project, present
 *   destructive  rejected / cancelled / blocked
 *
 * Note the deliberate reuse of `success` for both a task's DONE and a project's
 * ACTIVE — disambiguated by context + label, never contradictory on one surface.
 */
export interface StatusConfig {
  label: string;
  tone: SemanticTone;
  badgeVariant: BadgeVariant;
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

const FUNCTIONAL_REQUIREMENT_STATUS: Record<string, SemanticTone> = {
  DRAFT: 'neutral',
  REVIEW: 'warning',
  APPROVED: 'info',
  IMPLEMENTED: 'info',
  TESTED: 'info',
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
  CANCELLED: 'destructive',
};

const REQUIREMENT_STATUS: Record<string, SemanticTone> = {
  DRAFT: 'neutral',
  PROPOSED: 'neutral',
  // Awaiting a decision — "needs attention", same tone as REVIEW elsewhere.
  SUBMITTED: 'warning',
  APPROVED: 'info',
  IN_PROGRESS: 'info',
  ON_HOLD: 'warning',
  COMPLETED: 'success',
  REJECTED: 'destructive',
  ARCHIVED: 'neutral',
};

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function makeResolver(map: Record<string, SemanticTone>) {
  return (status: string | null | undefined): StatusConfig => {
    const key = String(status ?? '').toUpperCase();
    const tone = map[key] ?? 'neutral';
    const style = toneStyle[tone];
    return {
      label: titleCase(key || 'Unknown'),
      tone,
      badgeVariant: style.badgeVariant,
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

export const getTaskStatusConfig = makeResolver(TASK_STATUS);
export const getEpicStatusConfig = makeResolver(EPIC_STATUS);
export const getFunctionalRequirementStatusConfig = makeResolver(FUNCTIONAL_REQUIREMENT_STATUS);
export const getProjectStatusConfig = makeResolver(PROJECT_STATUS);
export const getSprintStatusConfig = makeResolver(SPRINT_STATUS);
export const getRequirementStatusConfig = makeResolver(REQUIREMENT_STATUS);
