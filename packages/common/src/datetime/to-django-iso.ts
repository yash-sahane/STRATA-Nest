/**
 * Format a Date as Django REST Framework does (settings `DATETIME_FORMAT`):
 *   "%Y-%m-%dT%H:%M:%S.%fZ"  →  2026-06-30T12:34:56.789000Z  (6-digit microseconds, Z)
 *
 * JS `Date` only has millisecond precision, so we pad ms → µs with "000".
 *
 * KNOWN LIMITATION (tracked in PHASE_1_AUTH_PLAN §Known parity items): for rows
 * originally written by Django with sub-millisecond microseconds, Prisma returns
 * a ms-truncated Date, so the last 3 digits may differ from Django's output.
 * Rows written by NestJS are exact. Resolve per-endpoint via raw-SQL string reads
 * only if a client flow proves to need it.
 */
export function toDjangoIso(value: Date | string): string {
  const iso = (value instanceof Date ? value : new Date(value)).toISOString();
  return iso.replace(/\.(\d{3})Z$/, '.$1000Z');
}
