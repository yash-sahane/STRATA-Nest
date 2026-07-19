/**
 * Semantic tone — the single vocabulary for status/priority meaning (COLOR-02).
 *
 * One tone per meaning, mapped to design tokens (DS-01) so status color has a
 * single source of truth and correct dark-mode behavior. Consumers should not
 * hand-write raw palette classes for status; resolve a tone here instead.
 *
 * Outputs are limited to the token-safe treatments: a Badge variant (which
 * carries an accessible foreground), a solid dot/indicator background, and a
 * solid border. Tinted "soft chip" backgrounds are intentionally not exposed
 * here because an accessible amber/warning tint needs a darker foreground than
 * a token currently provides; board column tints are handled in BOARD-01.
 */
export type SemanticTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive';

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info';

export interface ToneStyle {
  /** Use with `<Badge variant={...}>`. */
  badgeVariant: BadgeVariant;
  /** Solid background for status dots / small indicators. */
  dot: string;
  /** Solid border color (all sides). */
  border: string;
  /**
   * Left-edge accent only (e.g. a kanban card's leading border), for when the
   * card keeps its neutral border on the other three sides. Written as literal
   * classes so Tailwind can detect them — never build these by string concat.
   */
  borderLeft: string;
}

export const toneStyle: Record<SemanticTone, ToneStyle> = {
  neutral: {
    badgeVariant: 'secondary',
    dot: 'bg-muted-foreground',
    border: 'border-border',
    borderLeft: 'border-l-border',
  },
  info: { badgeVariant: 'info', dot: 'bg-info', border: 'border-info', borderLeft: 'border-l-info' },
  warning: {
    badgeVariant: 'warning',
    dot: 'bg-warning',
    border: 'border-warning',
    borderLeft: 'border-l-warning',
  },
  success: {
    badgeVariant: 'success',
    dot: 'bg-success',
    border: 'border-success',
    borderLeft: 'border-l-success',
  },
  destructive: {
    badgeVariant: 'destructive',
    dot: 'bg-destructive',
    border: 'border-destructive',
    borderLeft: 'border-l-destructive',
  },
};
