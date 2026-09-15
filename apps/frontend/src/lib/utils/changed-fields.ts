/**
 * Only what the person actually changed.
 *
 * Every edit dialog in this app submits its WHOLE form — title, description, status,
 * priority, dueDate, estimatedHours — regardless of which field was touched. The API's
 * update is a plain `prisma.update({ where: { id }, data })` with no version column and no
 * If-Match, so the last write wins outright.
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
 * What this does NOT solve is two people editing the SAME field. That needs a version
 * column and a conflict the user can see, which is a larger change and a product decision;
 * this removes the case where someone loses work they never had any way to notice.
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
