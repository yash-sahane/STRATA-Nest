import { AlertTriangle, ArrowUp, Minus, ArrowDown, type LucideIcon } from 'lucide-react';
import { toneStyle, type SemanticTone, type BadgeVariant } from './tone';

/**
 * Single source of truth for priority display (COLOR-01).
 *
 * Replaces the six divergent inline priority→color maps that conflicted
 * (LOW was gray on the task board but green everywhere else; MEDIUM was blue in
 * notifications but yellow elsewhere). The scale now maps consistently:
 *   LOW → neutral, MEDIUM → info, HIGH → warning, CRITICAL → destructive.
 */
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface PriorityConfig {
  label: string;
  tone: SemanticTone;
  badgeVariant: BadgeVariant;
  /** Solid background for a priority dot / left border. */
  dot: string;
  border: string;
  icon: LucideIcon;
  /** Higher = more urgent. Use for sorting. */
  score: number;
}

const BASE: Record<Priority, { label: string; tone: SemanticTone; icon: LucideIcon; score: number }> = {
  CRITICAL: { label: 'Critical', tone: 'destructive', icon: AlertTriangle, score: 4 },
  HIGH: { label: 'High', tone: 'warning', icon: ArrowUp, score: 3 },
  MEDIUM: { label: 'Medium', tone: 'info', icon: Minus, score: 2 },
  LOW: { label: 'Low', tone: 'neutral', icon: ArrowDown, score: 1 },
};

export function getPriorityConfig(priority: string | null | undefined): PriorityConfig {
  const key = String(priority ?? '').toUpperCase();
  // `URGENT` (used by notifications) is treated as the top priority.
  const base = key === 'URGENT' ? BASE.CRITICAL : (BASE[key as Priority] ?? BASE.MEDIUM);
  const tone = toneStyle[base.tone];
  return {
    label: base.label,
    tone: base.tone,
    badgeVariant: tone.badgeVariant,
    dot: tone.dot,
    border: tone.border,
    icon: base.icon,
    score: base.score,
  };
}

/** Sort comparator: most urgent first. */
export function byPriorityDesc(a: string | null | undefined, b: string | null | undefined): number {
  return getPriorityConfig(b).score - getPriorityConfig(a).score;
}
