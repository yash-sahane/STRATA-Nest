/**
 * Which calendar day is "today"?
 *
 * Attendance is filed against a DAY, not an instant, and until now the two halves of the
 * app answered that question with two different clocks:
 *
 *   the API        `todayUtc()` read the SERVER's local calendar parts
 *   the browser    `todayDateOnly()` read the BROWSER's local date
 *
 * They agree only while the employee and the server share a timezone. Measured with the
 * browser driven in Pacific/Midway (UTC-11) against this host:
 *
 *   browser says today is        2026-09-14
 *   the check-in row is filed as 2026-09-15
 *   that employee's calendar cell for the 14th showed no attendance at all
 *
 * So the employee checks in and nothing appears on the day they are living in — and the
 * row lands on a day that, for them, has not happened yet, which also puts it outside the
 * attendance-rate window. For an IST server, a US-based employee's afternoon crosses IST
 * midnight and files to tomorrow.
 *
 * This module is the single answer. The server derives the day here, and reports the zone
 * it used on `/auth/me` so the browser can derive the SAME day rather than its own.
 *
 * The zone is the host's, which is exactly what the previous behaviour already was — so
 * nothing about how rows are filed changes, and no existing data shifts. What changes is
 * that the browser now agrees.
 *
 * When this should become a per-workspace setting (an organisation declaring the office's
 * timezone, so a distributed team files against the office day rather than the server's
 * accident of deployment), only `businessTimezone` needs to start taking a workspace —
 * both derivations and the reported value follow from it.
 */

/** Whether a string names a timezone this runtime actually knows. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone || typeof zone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zone to file days in.
 *
 * `workspaceZone` is the organisation's own setting, when it has declared one. An
 * organisation's working day belongs to its office, not to wherever the server happens to
 * be deployed — a container moved from Mumbai to Virginia should not silently redraw
 * everybody's attendance.
 *
 * Without one, the host's zone, which is what this has always used. An unrecognised value
 * falls back the same way rather than throwing: a bad setting should not be able to take
 * attendance down.
 */
export function businessTimezone(workspaceZone?: string | null): string {
  if (workspaceZone && isValidTimeZone(workspaceZone)) return workspaceZone;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * The current calendar day in a zone, as `YYYY-MM-DD`.
 *
 * `en-CA` because its short date format IS ISO order; formatToParts would be the same
 * answer with more ceremony.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Today's day marker, as a UTC midnight Date.
 *
 * A day MARKER rather than an instant: keyed off the business day so a 01:00 check-in
 * files under the day the employee is actually working, with the mapper rendering it back
 * unshifted. Day-level rules (isWeekend) then read this marker's UTC parts, so they
 * describe exactly the day the row is filed under.
 */
export function businessDayMarker(workspaceZone?: string | null, now: Date = new Date()): Date {
  const [year, month, day] = todayIn(businessTimezone(workspaceZone), now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
