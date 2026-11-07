import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parseDateOnly } from "./utils/working-days"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Generate project code from name
/** Date-only wire value: 'YYYY-MM-DD' with no time component. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a wire date for display.
 *
 * A bare 'YYYY-MM-DD' is a calendar date, but `new Date('2026-08-08')` is UTC
 * midnight, which `toLocaleDateString` then renders as Aug 7 for every viewer
 * west of UTC. Date-only values are therefore split into local calendar parts;
 * full timestamps keep their normal instant semantics.
 */
export function parseWireDate(date: string | Date): Date {
  return typeof date === 'string' && DATE_ONLY.test(date) ? parseDateOnly(date) : new Date(date);
}

// Format date
export function formatDate(date: string | Date): string {
  const d = parseWireDate(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Get initials from name
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
