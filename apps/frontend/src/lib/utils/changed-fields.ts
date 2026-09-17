/**
 * Only what the person actually changed.
 *
 * Every edit dialog in this app submits its WHOLE form — title, description, status,
 * priority, dueDate, estimatedHours — regardless of which field was touched. The API's
 * update used to be a plain `prisma.update({ where: { id }, data })` with no version
 * column and no If-Match, so the last write won outright.
 *
 * Together those lose work silently. Measured on a shared task:
 *
 *     start                          priority LOW
 *     A opens the edit dialog, types a new title
 *     B sets priority CRITICAL       priority CRITICAL
 *     A saves (title only, in A's mind)
 *     result                         priority LOW   <- B's change is gone
 *
 * Neither person is told anything. A never touched priority; A's form simply still held
 * the value it had when the dialog opened, and sent it.
 *
 * The edit dialogs do re-seed from their props while nothing has been typed, so a
 * background refetch rescues the untouched case. That guard deliberately stops the moment
 * the first key is pressed — to protect the edit in progress — and from then on every
 * other field in the form is a snapshot of when it opened. That is the state a real edit
 * is always in by the time it is saved.
 *
 * Diffing against the snapshot the dialog opened with is what makes this correct rather
 * than merely narrower: a field the user did not touch compares equal to its own original
 * and is never transmitted, so a concurrent change to it cannot be overwritten. A field
 * they did touch is sent, including when they CLEARED it — `null` and `''` differ from a
 * previous value and travel, which the dueDate and epic fields depend on.
 *
 * What this does NOT solve on its own is two people editing the SAME field. That is what
 * `basedOnFor` below is for: the diff says what to write, and the baseline says what those
 * fields were believed to hold, so the API can refuse a save that would overwrite somebody
 * else's change to one of them.
 */

/** `undefined`, `null` and `''` all mean "not set" in these payloads. */
const unset = (v: unknown): boolean => v == null || v === '';

/** Values compared by content, so a Date and its ISO string do not read as different. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // A record with no epic carries `epicId: undefined`, while the form submits `''` — the
  // documented "no epic" value. Reading those as different would send epicId on every
  // save and clear an epic somebody else had just assigned, which is the very bug this
  // exists to prevent. The same holds for an absent description against an empty one.
  if (unset(a) && unset(b)) return true;
  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : new Date(a as string).getTime();
    const bt = b instanceof Date ? b.getTime() : new Date(b as string).getTime();
    return Number.isNaN(at) && Number.isNaN(bt) ? String(a) === String(b) : at === bt;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * The subset of `next` that differs from `original`.
 *
 * Keys absent from `next` are not considered: this narrows a submission, it does not
 * invent one. A key whose value is unchanged is omitted entirely, so the API — which
 * drops undefined keys from a PATCH — never writes it.
 */
export function changedFields<T extends Record<string, unknown>>(
  original: Partial<T> | null | undefined,
  next: T,
): Partial<T> {
  // With nothing to compare against, everything is a change. That is the safe direction:
  // it degrades to the previous behaviour rather than silently dropping the edit.
  if (!original) return next;

  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (!sameValue(original[key], next[key])) changed[key] = next[key];
  }
  return changed;
}

/**
 * What those fields were believed to hold, for the API to check against.
 *
 * `changedFields` says what to write; this says what the writer thought they were writing
 * over. Sent together as `basedOn`, they let the API refuse a save that would overwrite
 * somebody else's change to one of those same fields — and, just as importantly, accept
 * one that would not. Two people editing different parts of the same record is the normal
 * case and stays silent.
 *
 * Keyed on the CHANGES, not on the whole snapshot. A baseline covering fields this save
 * does not write would make the check row-level in effect, refusing an edit to the title
 * because somebody else set the priority. The API ignores such keys as well, but there is
 * no reason to put a whole record on the wire to have it thrown away.
 *
 * Values are taken from `original` — the row as the API rendered it, which is what the
 * dialog was seeded from — so both sides of the comparison are in the same shape. A key
 * missing from `original` is sent as `null`, which the API reads as "there was nothing
 * here", the same as `''` and `undefined`.
 */
export function basedOnFor<T extends Record<string, unknown>>(
  original: Partial<T> | null | undefined,
  changes: Partial<T>,
): Record<string, unknown> {
  const baseline: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) {
    baseline[key] = (original as Record<string, unknown> | null | undefined)?.[key] ?? null;
  }
  return baseline;
}
