/**
 * Guarded coercion for JSON-ish fields that arrive from the API.
 *
 * The `typeof value === 'string'` branch these replace exists precisely because
 * the code does not trust the field's wire type — but having decided the value
 * might be an arbitrary string, it then assumed that string was valid JSON and
 * called `JSON.parse` bare, inside a react-query `queryFn`. One malformed or
 * truncated `settings` value therefore threw a SyntaxError out of the query, and
 * the whole workspaces/projects list rendered its error state instead of data —
 * taking every screen that depends on the current workspace down with it.
 *
 * The API returns these as native objects today, so the string branch is not
 * taken; the exposure is one contract change or one legacy row away. Every other
 * JSON.parse in this app is already wrapped (use-task's normalizeIdList,
 * edit-task-dialog, search-history, realtime-client, rest-client) — these were
 * the gap.
 */

/** An object-valued field (`settings`). Anything unparseable becomes `{}`. */
export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** An array-of-string field (`memberIds`). Anything unparseable becomes `[]`. */
export function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
