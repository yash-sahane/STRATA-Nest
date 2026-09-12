import { BadRequestException } from '@nestjs/common';

/**
 * The calendar the product actually operates in. Postgres `timestamptz` happily
 * stores the year 20265, so an extra keystroke in a date field's year segment
 * used to be either accepted and rendered as garbage in every chart, or — when
 * the string was one JavaScript cannot parse at all — turned into an Invalid
 * Date that Prisma rejected with a bare 500 and a toast reading only "Internal
 * server error", with no clue which field was at fault.
 */
export const MIN_INPUT_YEAR = 1900;
export const MAX_INPUT_YEAR = 2200;

/**
 * Parse a wire date, or explain what is wrong with it.
 *
 * Empty string / null / undefined mean "no date" and return null, so the same
 * helper both sets and clears an optional column.
 */
export function toDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} is not a valid date.`);
  }
  const year = parsed.getUTCFullYear();
  if (year < MIN_INPUT_YEAR || year > MAX_INPUT_YEAR) {
    throw new BadRequestException(
      `${field} must be between ${MIN_INPUT_YEAR} and ${MAX_INPUT_YEAR}.`,
    );
  }
  return parsed;
}

/** `toDate` for a column that cannot be null. */
export function toRequiredDate(value: unknown, field: string): Date {
  const parsed = toDate(value, field);
  if (!parsed) throw new BadRequestException(`${field} is required.`);
  return parsed;
}

/**
 * A start that comes after its end is not a range.
 *
 * Nullable on purpose: an epic may carry a start with no target end, or neither
 * — only a pair that is actually present can be out of order. Projects and
 * sprints each grew their own copy of this check while epics grew none, so
 * `POST /epics {startDate:'2026-06-01', endDate:'2026-01-01'}` returned 201 and
 * the epic rendered a negative duration on every timeline that read it.
 */
export function assertDateRangeOrdered(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  labels: { start: string; end: string } = { start: 'Start date', end: 'End date' },
): void {
  if (!startDate || !endDate) return;
  if (endDate.getTime() < startDate.getTime()) {
    throw new BadRequestException(`${labels.end} must be on or after the ${labels.start.toLowerCase()}.`);
  }
}
