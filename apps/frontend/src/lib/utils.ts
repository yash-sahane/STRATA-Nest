import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Generate project code from name
export function generateProjectCode(name: string): string {
  // Reduce every word to ASCII alphanumerics BEFORE slicing it. Only the
  // one-word branch used to do this, so "🚀 Launch Pad" took `words[0][0]` —
  // the leading UTF-16 code unit of the rocket, i.e. half a surrogate pair.
  // A surrogate half is not encodable as UTF-8, so Postgres refused the insert
  // and creating the project failed with a bare "Internal server error".
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return 'PRJ';

  let code = '';

  if (words.length === 1) {
    code = words[0].substring(0, 3).toUpperCase();
    // Pad by repeating the last character if too short
    while (code.length < 3) {
      code += code[code.length - 1] || 'X';
    }
  } else if (words.length === 2) {
    code = (words[0].substring(0, 2) + words[1].substring(0, 1)).toUpperCase();
    if (code.length < 3) code += words[0][0]?.toUpperCase() || 'X';
  } else {
    code = words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
  }

  while (code.length < 3) code += 'X';
  return code.substring(0, 3);
}

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
  if (typeof date === 'string' && DATE_ONLY.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(date);
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
