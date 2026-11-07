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
}

export const DEFAULT_WORKDAY_START = '08:30';
export const DEFAULT_LATE_GRACE_MINUTES = 15;
/** Four hours: past that it is not a grace period, it is a different start time. */
export const MAX_LATE_GRACE_MINUTES = 240;

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
): { ok: true; settings: WorkspaceSettings } | { ok: false; message: string } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const settings: WorkspaceSettings = {};

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
