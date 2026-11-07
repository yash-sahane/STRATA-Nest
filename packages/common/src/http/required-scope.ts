import { BadRequestException } from '@nestjs/common';

/**
 * The single value of a query parameter a scoped list REQUIRES.
 *
 * Express parses a repeated parameter into an array, so `?taskId=A&taskId=A` —
 * which a duplicated link, a form submitted twice, or a hand-built URL produces
 * trivially — arrives as `['A', 'A']`. Three services asked
 *
 *     typeof query.taskId === 'string' ? query.taskId : undefined
 *
 * and threw NotFound when that was false. The caller HAD named the task; the
 * endpoint answered "Not found." because they named it twice.
 *
 * The authorisation check downstream is against ONE id, so genuinely distinct
 * values cannot be silently narrowed to the first — that would authorise against
 * one task and filter by another. Distinct values are refused explicitly instead,
 * and a repeat of the same value is accepted as the single value it is.
 *
 * A missing value is a 400, not a 404: the request is malformed, and answering
 * "Not found." for "you did not say which one" sends the caller looking for a
 * deleted record.
 */
export function requiredScopeParam(
  value: string | string[] | undefined,
  name: string,
): string {
  const only = optionalScopeParam(value, name);
  if (only === undefined) {
    throw new BadRequestException(`${name} is required.`);
  }
  return only;
}

/**
 * The same single-value reading where the parameter is OPTIONAL.
 *
 * The leave list uses `workspaceId` to decide whether the caller holds
 * leave:approve THERE; absent, it falls back to scoping the list to the caller's
 * own requests. So a missing value must not throw — but a repeated one still has
 * to resolve, and genuinely conflicting values still have to be refused rather
 * than resolved to whichever came first.
 */
export function optionalScopeParam(
  value: string | string[] | undefined,
  name: string,
): string | undefined {
  const values = (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);

  if (values.length === 0) return undefined;

  const distinct = [...new Set(values)];
  if (distinct.length > 1) {
    throw new BadRequestException(
      `${name} was given more than once with different values (${distinct
        .slice(0, 3)
        .join(', ')}). Provide exactly one.`,
    );
  }
  return distinct[0];
}

/**
 * A copy of `query` in which `name` can only mean `value`.
 *
 * For a list that has just authorised the caller against one value of a scope
 * parameter: every caller-supplied form of that key is dropped — the bare one
 * and each `__suffix` — and the checked value is put back, so nothing later in
 * the query can widen the list past what was authorised. The parser now ANDs
 * such predicates rather than letting one replace another, which closes the same
 * hole from the other side; this keeps a scoped list correct on its own terms.
 */
export function pinScopeParam(
  query: Record<string, string | string[] | undefined>,
  name: string,
  value: string,
): Record<string, string | string[] | undefined> {
  const pinned: Record<string, string | string[] | undefined> = {};
  for (const [key, entry] of Object.entries(query)) {
    if (key === name || key.startsWith(`${name}__`)) continue;
    pinned[key] = entry;
  }
  pinned[name] = value;
  return pinned;
}
