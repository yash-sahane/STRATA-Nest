/**
 * Moving a copied plan in time.
 *
 * A copy used to carry every date of its source unchanged, so cloning last
 * year's project made a new one whose sprints had all ended, whose epics were
 * long overdue and whose tasks were due months ago — a "new" project that was
 * late on the day it was made. The copy is moved instead: every date by the same
 * number of days, so the plan keeps its shape and starts on the copy's own
 * start day.
 *
 * Two kinds of date are moved. The project's, its sprints' and its epics' are
 * calendar days (`@db.Date` columns, read back as UTC midnight) and move by
 * whole UTC days. A task's due date is an INSTANT — the due day's midnight
 * where its picker ran — so it moves by calendar days on the workspace's wall
 * clock, keeping its time of day. Adding 24-hour periods instead would slide it
 * an hour across a daylight-saving change, and a midnight an hour earlier is
 * the evening of the day before.
 */

const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` day as the UTC-midnight marker a date column holds. */
export function dayMarker(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

/** The `YYYY-MM-DD` a date column's value stands for. */
export function markerDay(marker: Date): string {
  return marker.toISOString().slice(0, 10);
}

/** The `YYYY-MM-DD` an instant falls on, on the wall clock of `timeZone`. */
export function dayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Whole days from one `YYYY-MM-DD` to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMarker(to).getTime() - dayMarker(from).getTime()) / DAY_MS);
}

/** A date column's value, `days` calendar days later. */
export function shiftMarker(marker: Date, days: number): Date {
  return new Date(marker.getTime() + days * DAY_MS);
}

/** How far ahead of UTC the wall clock of `timeZone` reads at `instant`, in ms. */
function zoneOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
  const whole = instant.getTime() - instant.getUTCMilliseconds();
  return wall - whole;
}

/**
 * An instant `days` calendar days later on the wall clock of `timeZone`, at the
 * same time of day there. The offset is read once at the instant and once at
 * the result, which settles a move across a daylight-saving change.
 */
export function shiftInstant(instant: Date, days: number, timeZone: string): Date {
  if (days === 0) return new Date(instant.getTime());
  const wall = instant.getTime() + zoneOffset(instant, timeZone) + days * DAY_MS;
  const guess = wall - zoneOffset(instant, timeZone);
  return new Date(wall - zoneOffset(new Date(guess), timeZone));
}
