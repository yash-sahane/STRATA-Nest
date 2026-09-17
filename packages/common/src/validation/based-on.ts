import { IsObject, IsOptional } from 'class-validator';

/**
 * What the editor believed the fields they are changing held, when they started.
 *
 * Send it with an update and the API refuses the save — 409, nothing written — if
 * somebody else has changed any of those fields since. Omit it and the save applies
 * unconditionally, which is what an older client and every server-side caller do.
 *
 * PER FIELD, deliberately, and not a row-level version counter. Two people working on
 * the same task usually touch different things: one retitles it while the other
 * reprioritises it. A row-level check calls that a conflict and sends one of them back to
 * redo work that never clashed with anything — measured, and worse than the bug being
 * fixed, because it happens constantly while a genuine same-field clash is rare. Keyed on
 * the fields actually being written, those two saves both land and neither person is
 * interrupted; only an edit to a field somebody else has just edited is refused.
 *
 * Keys are the update DTO's own field names, and values are the row as the API rendered
 * it — i.e. exactly what came back from the GET this edit started from. Keys the save is
 * not writing are ignored, so the check can never be wider than the edit.
 *
 * Declared here rather than repeated across the five update DTOs, and because the global
 * ValidationPipe runs with `whitelist: true` — a DTO that does not declare the field has
 * it stripped from the body before the service sees it, which looks exactly like a client
 * that never sent one.
 *
 *     export class UpdateTaskDto {
 *       @BasedOn() basedOn?: Record<string, unknown>;
 *       ...
 *     }
 */
export function BasedOn(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    IsObject()(target, key);
  };
}

/**
 * Does a stored field still hold what the editor thought it held?
 *
 * Both sides arrive as the API renders them, so this is mostly a string comparison — but
 * three cases are not:
 *
 *   - a cleared field. `null`, `undefined` and `''` all mean "nothing here" across this
 *     codebase (see `changedFields` on the client, which uses the same rule); treating
 *     them as three different values would report a conflict between a field that was
 *     never set and one that was cleared.
 *   - a `Date`, when the comparison runs against a raw row rather than a mapped one.
 *   - a list or object — labels, assignees, attachments. Compared by their JSON, so
 *     order counts, which is correct here: a reordered assignee list IS a change
 *     somebody made and would be overwritten silently otherwise.
 */
export function sameFieldValue(stored: unknown, believed: unknown): boolean {
  const normalise = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return normalise(stored) === normalise(believed);
}
