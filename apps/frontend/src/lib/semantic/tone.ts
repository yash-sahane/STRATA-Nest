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
export type SemanticTone =
  | 'neutral'
  | 'info'
  | 'built'
  | 'verified'
  | 'warning'
  | 'success'
  | 'destructive';

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
  /**
   * Extra Badge classes for a tone that has no `--*` design token, and so no
   * Badge variant of its own. Empty string for every token-backed tone, so a
   * consumer can always pass it: `<Badge variant={t.badgeVariant}
   * className={t.badgeClassName}>`. `cn` runs tailwind-merge, which drops the
   * variant's own `bg-*`/`text-*`/`hover:bg-*` in favour of these.
   */
  badgeClassName: string;
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

/**
 * The two tones below carry a literal hex instead of a token, because the FR
 * lifecycle needs six tellable-apart stages and the palette only had four
 * chromatic hues (blue / amber / green / red). Promoting these into
 * `--built` / `--verified` in styles/globals.css plus matching Badge variants
 * is the right end state; neither of those files was reachable from here.
 *
 * One value per tone serves BOTH themes, exactly as `--warning` already does:
 * a mid-luminance fill clears AA under white text whichever card it sits on,
 * and still reads as a dot against either card. Measured (WCAG 2.1 relative
 * luminance, sRGB):
 *
 *   built    #8954d4  hsl(265 60% 58%)   white 4.90:1 · 98% fg 4.70:1
 *                                        on white card 4.90:1 · on #0a0a0a card 4.04:1
 *   verified #0b7e8e  hsl(187 85% 30%)   white 4.78:1 · 98% fg 4.58:1
 *                                        on white card 4.78:1 · on #0a0a0a card 4.14:1
 *
 * For reference the tokens they sit beside measure 4.62–4.69:1 on their own
 * foreground and ~4.05:1 on the dark card, so these are in family, not louder.
 *
 * `secondary` is the base variant rather than `outline`: if a call site ever
 * forgets `badgeClassName` the pill degrades to a legible grey chip instead of
 * white-on-transparent. The hex is written out at every use site rather than
 * held in a constant because Tailwind scans source TEXT — `bg-[${BUILT}]`
 * would generate no rule at all.
 */
export const toneStyle: Record<SemanticTone, ToneStyle> = {
  neutral: {
    badgeVariant: 'secondary',
    badgeClassName: '',
    dot: 'bg-muted-foreground',
    border: 'border-border',
    borderLeft: 'border-l-border',
  },
  info: {
    badgeVariant: 'info',
    badgeClassName: '',
    dot: 'bg-info',
    border: 'border-info',
    borderLeft: 'border-l-info',
  },
  built: {
    badgeVariant: 'secondary',
    badgeClassName: 'border-transparent bg-[#8954d4] text-white hover:bg-[#8954d4]/90',
    dot: 'bg-[#8954d4]',
    border: 'border-[#8954d4]',
    borderLeft: 'border-l-[#8954d4]',
  },
  verified: {
    badgeVariant: 'secondary',
    badgeClassName: 'border-transparent bg-[#0b7e8e] text-white hover:bg-[#0b7e8e]/90',
    dot: 'bg-[#0b7e8e]',
    border: 'border-[#0b7e8e]',
    borderLeft: 'border-l-[#0b7e8e]',
  },
  warning: {
    badgeVariant: 'warning',
    badgeClassName: '',
    dot: 'bg-warning',
    border: 'border-warning',
    borderLeft: 'border-l-warning',
  },
  success: {
    badgeVariant: 'success',
    badgeClassName: '',
    dot: 'bg-success',
    border: 'border-success',
    borderLeft: 'border-l-success',
  },
  destructive: {
    badgeVariant: 'destructive',
    badgeClassName: '',
    dot: 'bg-destructive',
    border: 'border-destructive',
    borderLeft: 'border-l-destructive',
  },
};
