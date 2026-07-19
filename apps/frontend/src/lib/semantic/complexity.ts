import { toneStyle, type SemanticTone, type BadgeVariant } from './tone';

/**
 * Single source of truth for functional-requirement complexity display.
 *
 * Replaces three copy-pasted complexityConfig maps, two of which built their
 * badge color via a template-literal className (`bg-${complexity.color}-500/10`)
 * — a string Tailwind's build-time class scanner cannot see, so those colors
 * were never actually generated and the badges silently rendered unstyled.
 */
export type Complexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface ComplexityConfig {
  label: string;
  tone: SemanticTone;
  badgeVariant: BadgeVariant;
  dot: string;
  border: string;
}

const BASE: Record<Complexity, { label: string; tone: SemanticTone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'info' },
  HIGH: { label: 'High', tone: 'warning' },
  VERY_HIGH: { label: 'Very High', tone: 'destructive' },
};

export function getComplexityConfig(complexity: string | null | undefined): ComplexityConfig {
  const key = String(complexity ?? '').toUpperCase();
  const base = BASE[key as Complexity] ?? BASE.MEDIUM;
  const tone = toneStyle[base.tone];
  return {
    label: base.label,
    tone: base.tone,
    badgeVariant: tone.badgeVariant,
    dot: tone.dot,
    border: tone.border,
  };
}
