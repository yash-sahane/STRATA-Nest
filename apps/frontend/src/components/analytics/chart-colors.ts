/**
 * Central chart colors sourced from the app design tokens (styles/globals.css).
 *
 * Colors are attached to data entries by semantic key — never assigned by array
 * position — so a status keeps the same color regardless of which slices are
 * present, across pages and across renders.
 *
 * These use the `--*-text` role, not the fill role. Recharts paints the legend
 * label in the same colour as the slice, so the value has to be readable as
 * TEXT on the card — the fill tokens are tuned for white text sitting on top of
 * them instead, and using them here measured 2.30:1 for Done and 2.51:1 for
 * Review against a white card.
 */

/** Task status colors (canonical statuses). */
export const STATUS_COLORS: Record<string, string> = {
  BACKLOG: 'hsl(var(--muted-foreground))',
  TODO: 'hsl(var(--chart-3))',
  IN_PROGRESS: 'hsl(var(--app-info-text))',
  REVIEW: 'hsl(var(--chart-4))',
  DONE: 'hsl(var(--app-success-text))',
};

/**
 * The status and priority maps follow the badges (lib/semantic): a value has one
 * colour everywhere. The one exception is a pie's neighbouring slices — To Do and
 * Backlog share the neutral badge, so To Do takes a series colour to stay apart.
 */

/** Task priority colors (Low neutral, Medium info, High warning, Critical destructive). */
export const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'hsl(var(--muted-foreground))',
  MEDIUM: 'hsl(var(--app-info-text))',
  HIGH: 'hsl(var(--app-warning-text))',
  CRITICAL: 'hsl(var(--destructive-text))',
};

/** Project status colors (Active success, Completed info — as their badges). */
export const PROJECT_STATUS_COLORS: Record<string, string> = {
  PLANNING: 'hsl(var(--muted-foreground))',
  ACTIVE: 'hsl(var(--app-success-text))',
  COMPLETED: 'hsl(var(--app-info-text))',
  ON_HOLD: 'hsl(var(--app-warning-text))',
  ARCHIVED: 'hsl(var(--muted-foreground))',
};

/** General-purpose series colors for line/bar charts without semantic keys. */
export const CHART_SERIES_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];
