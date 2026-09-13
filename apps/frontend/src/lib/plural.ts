/**
 * "1 day", not "1 days".
 *
 * Counts were interpolated straight into a hardcoded plural in a dozen places —
 * `${daysUntil} days`, `${n} tasks, ${m} sprints`, `${n} members` — so a single
 * item read "1 days" on the dashboard, the calendar, the project cards and the
 * sprint analytics. One helper, rather than a ternary repeated at each site, because
 * the repeated ternary is how half of them ended up without one.
 *
 * `of`-phrases are deliberately NOT covered: "1 of 5 tasks" is already correct and
 * pluralising the noun there would be wrong.
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const word = count === 1 ? singular : (pluralForm ?? `${singular}s`);
  return `${count} ${word}`;
}

/** The noun alone, for callers that render the number separately. */
export function pluralWord(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}
