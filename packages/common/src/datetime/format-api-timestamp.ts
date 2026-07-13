/**
 * Format a Date per the API's canonical timestamp contract:
 *   "%Y-%m-%dT%H:%M:%S.%fZ"  →  2026-06-30T12:34:56.789000Z  (6-digit microseconds, Z)
 *
 * JS `Date` only has millisecond precision, so we pad ms → µs with "000".
 *
 * KNOWN LIMITATION: for rows whose timestamps originated with sub-millisecond
 * microsecond precision, Prisma returns a ms-truncated Date, so the last 3
 * digits may not reflect the original sub-ms value. Rows written by this
 * application are exact. Resolve per-endpoint via raw-SQL string reads only if
 * a client flow proves to need it.
 */
export function formatApiTimestamp(value: Date | string): string {
  const iso = (value instanceof Date ? value : new Date(value)).toISOString();
  return iso.replace(/\.(\d{3})Z$/, '.$1000Z');
}
