import { toast } from 'sonner';
import { ApiError } from './rest-client';

/**
 * Envelope `type` values the API pins on the two lost-update answers
 * (apps/api/src/modules/workspaces/scoped-crud.base.ts).
 *
 * Matched on instead of the message text, which is written for people and will be
 * reworded, and instead of the status, which is not specific enough: a 409 in this API
 * also means "that project code is taken" and "this requirement still has children", and
 * a 404 is usually just a missing row.
 */
const CHANGED_WHILE_EDITING = 'ChangedWhileEditing';
const DELETED = 'DeletedWhileEditing';

/** The API's own words when it has them; the caller's line only as a last resort. */
function describe(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message || fallback;
}

/**
 * The toast for a failed save.
 *
 * Somebody else having saved first is not the same kind of event as a save that broke,
 * and titling it "Error" says the wrong thing twice over: it implies the app
 * malfunctioned, and it implies there is nothing to do. Nothing malfunctioned — the API
 * declined the write precisely so that the other person's work survived — and there is
 * something to do, which the API's message spells out.
 *
 * The form stays open behind this in every caller, so the title can talk about the save
 * rather than warning about lost input.
 */
export function describeSaveFailure(
  error: unknown,
  fallback: string
): { title: string; description?: string } {
  const type = error instanceof ApiError ? error.type : '';
  if (type === CHANGED_WHILE_EDITING) {
    return {
      title: 'Not saved — somebody else edited this field first',
      description: describe(error, fallback),
    };
  }
  if (type === DELETED) {
    return { title: 'Not saved — this no longer exists', description: describe(error, fallback) };
  }
  // Titled by what failed — "Failed to update task" — with the server's reason
  // under it. Every other failure was titled "Error", which says neither.
  const reason = describe(error, '');
  return { title: fallback, description: reason && reason !== fallback ? reason : undefined };
}

/** Show the toast for a failed save — see describeSaveFailure. */
export function showSaveFailure(error: unknown, fallback: string): void {
  const { title, description } = describeSaveFailure(error, fallback);
  toast.error(title, { description });
}

/** A save refused because somebody else changed one of the same fields first. */
export function isEditConflict(error: unknown): boolean {
  return error instanceof ApiError && error.type === CHANGED_WHILE_EDITING;
}
