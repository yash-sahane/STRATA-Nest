import { businessTimezone, isValidTimeZone } from './business-day';

/**
 * What a workspace may declare about itself in `Workspace.settings`.
 *
 * The column is free-form JSON and was written as such: whatever object the
 * browser sent was stored whole. That is how three switches came to be saved for
 * years and read by nothing. This is the contract instead — the keys below, each
 * with one meaning and at least one reader, and nothing else is kept.
 */
export interface WorkspaceSettings {
  /** IANA zone the office keeps its days — and its start time — in. */
  timezone?: string;
  /** 'HH:MM', 24-hour: when the working day starts. */
  workdayStart?: string;
  /** Minutes after the start before an arrival counts as late. */
  lateGraceMinutes?: number;
  /**
   * The Saturdays the office works, as a history: each period holds from its
   * `from` day until the next one starts, and days before the first keep
   * DEFAULT_WORKING_SATURDAYS.
   *
   * A history rather than one value because a change applies from the day it is
   * made. The days before it were worked — and leave across them charged —
   * under the rule in force then; read again under the new one, last month's
   * attendance rate and balances already settled would change without anybody
   * changing them. Written by the server (`withWorkingSaturdays`) from a
   * request's `workingSaturdays`, never taken from a request as it is.
   */
  workingWeek?: WorkingWeekPeriod[];
}

/** One stretch of a workspace's working week. */
export interface WorkingWeekPeriod {
  /** The first day it applies to, 'YYYY-MM-DD', in the workspace's own day. */
  from: string;
  /** Weeks of the month (1–5) whose Saturday is a working day; [] for none. */
  saturdays: number[];
}

/** What a request may declare: the working week as the rule from today on. */
export type WorkspaceSettingsInput = Omit<WorkspaceSettings, 'workingWeek'> & {
  /** Weeks of the month (1–5) whose Saturday is worked from today on; [] for none. */
  workingSaturdays?: number[];
};

export const DEFAULT_WORKDAY_START = '08:30';
export const DEFAULT_LATE_GRACE_MINUTES = 15;
/** Four hours: past that it is not a grace period, it is a different start time. */
export const MAX_LATE_GRACE_MINUTES = 240;
/**
 * The Saturdays worked when a workspace has not said: the 1st and the 3rd of
 * the month — the rule every workspace ran on before it could declare its own,
 * so a workspace that never touches the setting sees no day change. Sundays
 * are never working days.
 */
export const DEFAULT_WORKING_SATURDAYS: readonly number[] = [1, 3];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const isWeekList = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((week) => typeof week === 'number' && Number.isInteger(week) && week >= 1 && week <= 5);

const weekSet = (weeks: readonly number[]): number[] =>
  [...new Set(weeks)].sort((a, b) => a - b);

const sameWeeks = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((week, i) => week === b[i]);

/**
 * The working-week history a workspace's stored settings describe, oldest
 * first. Tolerant, as `workScheduleOf` is: a malformed period is skipped, not
 * allowed to stop anybody checking in.
 */
export function workingWeekOf(settings: unknown): WorkingWeekPeriod[] {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).workingWeek
      : undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (period): period is { from: string; saturdays: number[] } =>
        !!period &&
        typeof period === 'object' &&
        typeof (period as { from?: unknown }).from === 'string' &&
        DAY_KEY.test((period as { from: string }).from) &&
        isWeekList((period as { saturdays?: unknown }).saturdays),
    )
    .map((period) => ({ from: period.from, saturdays: weekSet(period.saturdays) }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** The Saturdays worked on `day` ('YYYY-MM-DD'), by the rule in force on it. */
export function workingSaturdaysOn(
  day: string,
  periods: readonly WorkingWeekPeriod[],
): readonly number[] {
  let weeks: readonly number[] = DEFAULT_WORKING_SATURDAYS;
  for (const period of periods) {
    if (period.from > day) break;
    weeks = period.saturdays;
  }
  return weeks;
}

/**
 * The history with `saturdays` in force from `fromDay` on.
 *
 * Periods from `fromDay` onward are replaced — a second change on the same day
 * corrects the first rather than stacking behind it — and nothing is added
 * when the rule is already the one in force, so saving the settings form with
 * the working week untouched writes no new period.
 */
export function withWorkingSaturdays(
  periods: readonly WorkingWeekPeriod[],
  saturdays: readonly number[],
  fromDay: string,
): WorkingWeekPeriod[] {
  const kept = periods.filter((period) => period.from < fromDay);
  const next = weekSet(saturdays);
  if (sameWeeks(workingSaturdaysOn(fromDay, kept), next)) return kept;
  return [...kept, { from: fromDay, saturdays: next }];
}

/**
 * The settings to store: what a checked request declares, with the working
 * week folded into the stored history from `today` — the workspace's own day
 * — on. A request that does not mention the working week leaves it as it is.
 */
export function settingsToStore(
  input: WorkspaceSettingsInput,
  stored: unknown,
  today: string,
): WorkspaceSettings {
  const { workingSaturdays, ...declared } = input;
  const history = workingWeekOf(stored);
  const workingWeek =
    workingSaturdays === undefined ? history : withWorkingSaturdays(history, workingSaturdays, today);
  return workingWeek.length ? { ...declared, workingWeek } : declared;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 'HH:MM' as minutes after midnight, or null when it is not a time of day. */
export function clockToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = CLOCK.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const isBlank = (value: unknown) => value === undefined || value === null || value === '';

/**
 * Check a settings object from a request and reduce it to the keys above.
 *
 * A blank value withdraws that declaration (the key is left out, and its reader
 * falls back to the default) rather than being stored as an empty one. A value
 * that is present but wrong is refused with a sentence naming it: stored, it
 * would be skipped by every reader in silence, and the office would run on the
 * default while its settings page showed something else.
 */
export function parseWorkspaceSettings(
  input: unknown,
): { ok: true; settings: WorkspaceSettingsInput } | { ok: false; message: string } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const settings: WorkspaceSettingsInput = {};

  if (!isBlank(raw.timezone)) {
    if (typeof raw.timezone !== 'string' || !isValidTimeZone(raw.timezone)) {
      return {
        ok: false,
        message: `'${String(raw.timezone)}' is not a recognised IANA timezone (for example 'Asia/Kolkata').`,
      };
    }
    settings.timezone = raw.timezone;
  }

  if (!isBlank(raw.workdayStart)) {
    if (clockToMinutes(raw.workdayStart) === null) {
      return {
        ok: false,
        message: `'${String(raw.workdayStart)}' is not a time of day. Use 24-hour HH:MM, for example '09:00'.`,
      };
    }
    settings.workdayStart = raw.workdayStart as string;
  }

  if (!isBlank(raw.lateGraceMinutes)) {
    const grace = raw.lateGraceMinutes;
    if (
      typeof grace !== 'number' ||
      !Number.isInteger(grace) ||
      grace < 0 ||
      grace > MAX_LATE_GRACE_MINUTES
    ) {
      return {
        ok: false,
        message: `The grace period has to be a whole number of minutes between 0 and ${MAX_LATE_GRACE_MINUTES}.`,
      };
    }
    settings.lateGraceMinutes = grace;
  }

  // An empty list is a declaration — no Saturday is worked — not a blank.
  if (raw.workingSaturdays !== undefined && raw.workingSaturdays !== null) {
    if (!isWeekList(raw.workingSaturdays)) {
      return {
        ok: false,
        message:
          'Working Saturdays are weeks of the month: whole numbers from 1 to 5, for example [1, 3] for the 1st and 3rd. An empty list means no Saturday is worked.',
      };
    }
    settings.workingSaturdays = weekSet(raw.workingSaturdays);
  }

  return { ok: true, settings };
}

/** The hours an office keeps, resolved: every field has a value. */
export interface WorkSchedule {
  /** Minutes after local midnight the working day starts. */
  startMinutes: number;
  /** Minutes of leeway after the start before an arrival counts as late. */
  graceMinutes: number;
  /** IANA zone the start time is read in. */
  timeZone: string;
  /** Which Saturdays are worked, and since when — see `workingSaturdaysOn`. */
  workingWeek: WorkingWeekPeriod[];
}

/**
 * The schedule a workspace's stored settings describe.
 *
 * Tolerant where `parseWorkspaceSettings` is strict: this reads rows that
 * predate the check, and a bad value must not be able to stop people checking
 * in. Anything unusable falls back to the default for that field alone.
 */
export function workScheduleOf(settings: unknown): WorkSchedule {
  const raw = (settings && typeof settings === 'object' ? settings : {}) as Record<
    string,
    unknown
  >;
  const grace = raw.lateGraceMinutes;
  return {
    startMinutes:
      clockToMinutes(raw.workdayStart) ?? (clockToMinutes(DEFAULT_WORKDAY_START) as number),
    graceMinutes:
      typeof grace === 'number' &&
      Number.isInteger(grace) &&
      grace >= 0 &&
      grace <= MAX_LATE_GRACE_MINUTES
        ? grace
        : DEFAULT_LATE_GRACE_MINUTES,
    timeZone: businessTimezone(typeof raw.timezone === 'string' ? raw.timezone : null),
    workingWeek: workingWeekOf(raw),
  };
}

/**
 * Minutes after midnight that an instant falls on, on the wall clock of a zone.
 *
 * "Late" is a statement about the office's clock. Read off the server's instead,
 * a 09:00 arrival in Kolkata was graded against whatever 09:00 IST happened to be
 * where the container ran — 03:30 on a UTC host, so nobody was ever late.
 */
export function minutesOfDayIn(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type: 'hour' | 'minute') =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return read('hour') * 60 + read('minute');
}
