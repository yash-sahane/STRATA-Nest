/**
 * Canonical working-day and date-only utilities.
 *
 * Single source of truth for:
 * - date-only ('YYYY-MM-DD') <-> Date conversions using LOCAL calendar parts
 *   (never `toISOString()`, which shifts the day for non-UTC timezones), and
 * - the working-day rule: Monday-Friday plus alternate working Saturdays
 *   (weeks 1 and 3 of each month); Sundays and week 2/4/5 Saturdays are off.
 *
 * Attendance, leave, and calendar math must all import these helpers so the
 * subsystems agree about which days count as working days.
 */

/** Weeks of the month (1-5) whose Saturday is a working day. */
export const WORKING_SATURDAY_WEEKS = [1, 3];

const pad = (n: number): string => String(n).padStart(2, '0');

/** Format a Date as 'YYYY-MM-DD' using its LOCAL calendar day. */
export function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Parse the leading 'YYYY-MM-DD' of a date or date-time string into a Date at
 * LOCAL midnight. (`new Date('YYYY-MM-DD')` is UTC midnight, which reads as
 * the previous local day in UTC-negative timezones.)
 */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

/**
 * The zone the SERVER files days in, reported by `/auth/me`.
 *
 * Null until that response lands, and on an API that does not send it — in both cases
 * the browser's own date is used, which is what this always did.
 *
 * A module-level value rather than React state because `todayDateOnly()` is called from
 * pure helpers (this file, attendance-utils, leave-utils) that have no hooks.
 */
/**
 * Where "today" comes from, in order of authority.
 *
 *   workspace  the organisation's own declaration (Workspace.settings.timezone)
 *   server     what the API itself files days against (/auth/me businessTimezone)
 *   browser    before either has arrived, and on an API that sends neither
 *
 * Two slots rather than one variable, because the two writers would otherwise fight: a
 * workspace with no declared zone writing null would wipe the server zone and drop the
 * browser back to its own clock — the exact disagreement this exists to prevent.
 *
 * Module-level rather than React state because `todayDateOnly()` is called from pure
 * helpers (this file, attendance-utils, leave-utils) that have no hooks.
 */
let workspaceTimeZone: string | null = null;
let serverTimeZone: string | null = null;

const clean = (v: string | null | undefined): string | null =>
  v && v.trim() ? v.trim() : null;

/** The zone the API reports it files days in. Set when `/auth/me` resolves. */
export function setServerTimeZone(timeZone: string | null | undefined): void {
  serverTimeZone = clean(timeZone);
}

/** The current workspace's declared zone, or null when it has not declared one. */
export function setWorkspaceTimeZone(timeZone: string | null | undefined): void {
  workspaceTimeZone = clean(timeZone);
}

/** The zone the API files days in, or null before `/auth/me` has answered. */
export function getServerTimeZone(): string | null {
  return serverTimeZone;
}

/** The zone actually in force, for diagnostics. */
export function getBusinessTimeZone(): string | null {
  return workspaceTimeZone ?? serverTimeZone;
}

/**
 * Today's calendar date as 'YYYY-MM-DD', in the zone days are FILED against — the
 * workspace's declared zone if it has one, otherwise the server's.
 *
 * This used to be the BROWSER's local date, and the two disagree for anyone not sharing
 * the server's timezone: a member in Pacific/Midway checked in and the row was filed
 * under a day their own calendar called tomorrow — so the calendar showed nothing on the
 * day they were living in, and the row fell outside the attendance-rate window entirely.
 *
 * Falls back to the browser's date while the zone is unknown, which is the previous
 * behaviour and correct for everyone in the server's own region.
 */
export function todayDateOnly(): string {
  return businessDateOf(new Date());
}

/**
 * The calendar date an instant falls on, as 'YYYY-MM-DD', in the same zone as
 * `todayDateOnly` — so the two can be compared.
 *
 * `String(timestamp).slice(0, 10)` is the date in UTC, which is not the business
 * day for hours of every day anywhere else: somebody added to a workspace at
 * 00:30 in Kolkata (19:00 UTC, the day before) was taken to have joined the
 * previous day — a working day — and was shown absent for it, at a 0%
 * attendance rate, for a day before they belonged.
 *
 * A value that is already a plain date is returned as it is: read as an instant
 * it would be UTC midnight, the day before anywhere west of UTC. An unreadable
 * value gives ''.
 */
export function businessDateOf(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  const zone = workspaceTimeZone ?? serverTimeZone;
  if (!zone) return formatDateOnly(instant);
  try {
    // `en-CA` short format IS ISO order.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    // An unrecognised zone must not take the app down over a date label.
    return formatDateOnly(instant);
  }
}

/** Week of the month (1-5) a date falls in. */
export function getWeekOfMonth(date: string): number {
  const d = parseDateOnly(date);
  const firstDayOfWeek = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  return Math.ceil((d.getDate() + firstDayOfWeek) / 7);
}

/** Saturdays of weeks 1 and 3 are working days. */
export function isSaturdayWorking(date: string): boolean {
  return WORKING_SATURDAY_WEEKS.includes(getWeekOfMonth(date));
}

/** Sunday, or a non-working (week 2/4/5) Saturday. */
export function isWeekend(date: string): boolean {
  const day = parseDateOnly(date).getDay();
  if (day === 0) return true;
  if (day === 6) return !isSaturdayWorking(date);
  return false;
}

/**
 * Public-holiday dates, as 'YYYY-MM-DD' strings or a Set of them. Accepted by
 * every working-day predicate and counter so a public holiday stops counting as
 * a working day in attendance and leave denominators. Values may carry a time
 * component; only the leading date part is compared.
 */
export type HolidayDates = ReadonlySet<string> | readonly string[];

const EMPTY_HOLIDAYS: ReadonlySet<string> = new Set<string>();

/**
 * Normalize a holiday collection to a Set of 'YYYY-MM-DD' keys. Build this once
 * per render and pass the Set (not the raw array) into the loops below, so a
 * month's worth of days does not re-normalize the same list 31 times.
 */
export function toHolidaySet(holidays?: HolidayDates): ReadonlySet<string> {
  if (!holidays) return EMPTY_HOLIDAYS;
  const normalized = new Set<string>();
  Array.from(holidays as Iterable<string>).forEach((value) => {
    normalized.add(String(value).slice(0, 10));
  });
  return normalized;
}

/** A Set is trusted to already hold date-only keys (i.e. came from toHolidaySet). */
function holidaySetOf(holidays: HolidayDates): ReadonlySet<string> {
  return holidays instanceof Set ? holidays : toHolidaySet(holidays);
}

/** True when the date falls on a configured public holiday. */
export function isHoliday(date: string, holidays?: HolidayDates): boolean {
  if (!holidays) return false;
  return holidaySetOf(holidays).has(date.slice(0, 10));
}

/**
 * Monday-Friday, plus working Saturdays (weeks 1 and 3), minus public holidays.
 * `holidays` is optional so existing callers keep the weekend-only rule until
 * they have a holiday list to pass.
 */
export function isWorkingDay(date: string, holidays?: HolidayDates): boolean {
  if (isWeekend(date)) return false;
  return !holidays || !holidaySetOf(holidays).has(date.slice(0, 10));
}

/** Count working days in a month, including alternate Saturdays (0-based month). */
export function countWorkingDaysInMonth(
  year: number,
  month: number,
  holidays?: HolidayDates,
): number {
  const holidaySet = toHolidaySet(holidays);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    if (isWorkingDay(formatDateOnly(new Date(year, month, day)), holidaySet)) {
      workingDays++;
    }
  }

  return workingDays;
}

/** All working Saturdays in a month as 'YYYY-MM-DD' strings (0-based month). */
export function getWorkingSaturdaysInMonth(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const workingSaturdays: string[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    if (date.getDay() === 6) {
      const dateString = formatDateOnly(date);
      if (isSaturdayWorking(dateString)) {
        workingSaturdays.push(dateString);
      }
    }
  }

  return workingSaturdays;
}

/** First and last day of a month as 'YYYY-MM-DD' (0-based month). */
export function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  return {
    start: formatDateOnly(new Date(year, month, 1)),
    end: formatDateOnly(new Date(year, month + 1, 0)),
  };
}

/**
 * Count working days in an inclusive date range (date-only strings).
 * Honors the alternate-Saturday rule so leave durations and attendance
 * denominators agree about what a working day is. Pass `holidays` to exclude
 * public holidays from the count as well.
 */
export function countWorkingDaysBetween(
  startDate: string,
  endDate: string,
  holidays?: HolidayDates,
): number {
  const holidaySet = toHolidaySet(holidays);
  const end = parseDateOnly(endDate);
  const current = parseDateOnly(startDate);
  let count = 0;

  while (current <= end) {
    if (isWorkingDay(formatDateOnly(current), holidaySet)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}
