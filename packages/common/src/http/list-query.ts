/**
 * Allowlisted list-query parser: parses the versioned list-query request
 * shape the frontend sends — camelCase keys, `__<op>` suffixes,
 * comma lists, and `ordering=field,-field` — into a Prisma `where`/`orderBy`.
 * A field is only honored if it appears in the per-resource ALLOWLIST `spec`,
 * never an arbitrary model field.
 *
 * Operators:
 *   (none)=eq | __ne | __lt | __lte | __gt | __gte
 *   __icontains | __istartswith | __iendswith | __isnull | __not_in
 *   multi-value or comma-joined (no suffix) => `in`
 */

import { normalizePageParams } from './pagination';

/**
 * `json-array`: the field is a JSON list, and `?key=value` means "the list holds
 * value" (several values: holds all of them).
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'json-array';

export interface FilterFieldSpec {
  /** Prisma field name this API key maps to. */
  field: string;
  type?: FieldType;
}

export interface ListQuerySpec {
  /** apiKey -> { prismaField, type } */
  filterable: Record<string, FilterFieldSpec>;
  /** apiKey -> prismaField */
  sortable: Record<string, string>;
  /** The fields `?q=` searches, case-insensitively, any of them matching. */
  search?: string[];
  defaultOrderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
}

export interface ParsedListQuery {
  where: Record<string, unknown>;
  orderBy: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

const RESERVED = new Set(['page', 'pageSize', 'ordering', 'q']);

/**
 * Unknown filter/sort keys are dropped silently — that is the security contract
 * (an arbitrary model field must never reach `where`), but it also means a
 * client typo or a spec that forgot a field produces an unfiltered list instead
 * of an error, which is how the invite-code lookup shipped broken. Surface it in
 * development only: never in production (log noise from hostile query strings)
 * and never in tests (the allowlist specs assert on dropping).
 */
function warnUnknownKey(kind: 'filter' | 'sort', apiKey: string): void {
  if (process.env.NODE_ENV !== 'development') return;
  // eslint-disable-next-line no-console
  console.warn(
    `[parseListQuery] ignoring unknown ${kind} key "${apiKey}" — it is not in this resource's allowlist, so it did NOT narrow the result set.`,
  );
}

function coerce(type: FieldType | undefined, value: string): unknown {
  switch (type) {
    case 'number':
      return Number(value);
    case 'boolean':
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    case 'date':
      return new Date(value);
    default:
      return value;
  }
}

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  // A single "a,b,c" expands to a list (the versioned comma-list contract).
  if (arr.length === 1 && arr[0].includes(',')) return arr[0].split(',').filter(Boolean);
  return arr.filter((x) => x !== '');
}

function buildClause(
  op: string,
  values: string[],
  type: FieldType | undefined,
): unknown {
  const one = () => coerce(type, values[0]);
  const many = () => values.map((v) => coerce(type, v));
  if (type === 'json-array') return { array_contains: values };
  switch (op) {
    case 'ne':
      return { not: one() };
    case 'lt':
      return { lt: one() };
    case 'lte':
      return { lte: one() };
    case 'gt':
      return { gt: one() };
    case 'gte':
      return { gte: one() };
    case 'icontains':
      return { contains: values[0], mode: 'insensitive' };
    case 'istartswith':
      return { startsWith: values[0], mode: 'insensitive' };
    case 'iendswith':
      return { endsWith: values[0], mode: 'insensitive' };
    case 'isnull':
      return ['1', 'true', 'yes'].includes((values[0] ?? '').toLowerCase())
        ? { equals: null }
        : { not: null };
    case 'not_in':
      return { notIn: many() };
    case 'in':
      return { in: many() };
    default: // eq
      return values.length > 1 ? { in: many() } : one();
  }
}

/** A Prisma operator object (`{ not }`, `{ gte }`, ...) as opposed to a scalar
 *  equality. A Date is a scalar here: spreading one yields `{}`. */
function isOperatorClause(clause: unknown): clause is Record<string, unknown> {
  return (
    typeof clause === 'object' &&
    clause !== null &&
    !Array.isArray(clause) &&
    !(clause instanceof Date)
  );
}

/**
 * Add one clause for a field. A later clause may NARROW an earlier one; it must
 * never REPLACE it.
 *
 * Every suffixed form of a key (`taskId`, `taskId__ne`, `taskId__in`) lands on
 * the same Prisma field, and they used to be merged last-one-wins: a scalar
 * equality was simply overwritten by whatever came after it. A scoped list
 * authorises the caller against the value they named and then hands the whole
 * query here, so `?taskId=<mine>&taskId__ne=x` was checked against one task and
 * filtered by `{ not: 'x' }` — every comment in the database, in every tenant.
 * `?workspaceId=<where I approve>&workspaceId__in=<where I do not>` read another
 * workspace's leave, attendance and time entries the same way.
 *
 * Operator objects with no key in common still merge in place — that is the
 * `createdAt__gte` + `createdAt__lte` range, and its shape is unchanged. Anything
 * else is ANDed, so two predicates on one field always both apply.
 */
function addClause(where: Record<string, unknown>, field: string, clause: unknown): void {
  const existing = where[field];
  if (existing === undefined) {
    where[field] = clause;
    return;
  }
  if (
    isOperatorClause(existing) &&
    isOperatorClause(clause) &&
    !Object.keys(clause).some((key) => key in existing)
  ) {
    where[field] = { ...existing, ...clause };
    return;
  }
  const and = (where.AND as Array<Record<string, unknown>> | undefined) ?? [];
  and.push({ [field]: clause });
  where.AND = and;
}

/**
 * The order, made total: `id` is appended as the last key.
 *
 * Lists are paged by OFFSET, and most sort keys are not unique — a task's
 * `position` defaults to 0 (every AI-generated task has it), and rows written in
 * one transaction share `createdAt`. Postgres returns ties in whatever order the
 * plan happens to produce, which need not be the same for the query that reads
 * page 1 and the one that reads page 2: a row on the boundary could come back on
 * both pages or on neither, so a walk of every page (`listAll` — the dashboard
 * and analytics counts) returned duplicates and gaps. `id` is unique, so with it
 * last no two rows tie and the pages partition the list.
 */
function withTiebreaker(
  orderBy: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>,
): Array<Record<string, 'asc' | 'desc'>> {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return clauses.some((clause) => 'id' in clause) ? clauses : [...clauses, { id: 'asc' }];
}

export function parseListQuery(
  query: Record<string, string | string[] | undefined>,
  spec: ListQuerySpec,
): ParsedListQuery {
  const where: Record<string, unknown> = {};

  for (const [rawKey, rawVal] of Object.entries(query)) {
    if (RESERVED.has(rawKey)) continue;
    const [apiKey, suffix] = rawKey.split('__', 2);
    const fieldSpec = spec.filterable[apiKey];
    if (!fieldSpec) {
      // ALLOWLIST — ignore unknown fields (dev-mode warn, see warnUnknownKey).
      warnUnknownKey('filter', apiKey);
      continue;
    }

    const values = asArray(rawVal);
    if (values.length === 0 && suffix !== 'isnull') continue;

    const op = suffix ?? (values.length > 1 ? 'in' : 'eq');
    addClause(where, fieldSpec.field, buildClause(op, values, fieldSpec.type));
  }

  // q=text: any of the resource's search fields contains it.
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q && spec.search?.length) {
    const and = (where.AND as Array<Record<string, unknown>> | undefined) ?? [];
    and.push({ OR: spec.search.map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })) });
    where.AND = and;
  }

  // ordering=field,-field
  let orderBy = spec.defaultOrderBy ?? { createdAt: 'desc' as const };
  const ordering = query.ordering;
  if (typeof ordering === 'string' && ordering.trim()) {
    const clauses = ordering
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((token) => {
        const desc = token.startsWith('-');
        const apiKey = desc ? token.slice(1) : token;
        const field = spec.sortable[apiKey];
        if (!field) {
          warnUnknownKey('sort', apiKey);
          return null;
        }
        return { [field]: (desc ? 'desc' : 'asc') as 'asc' | 'desc' };
      })
      .filter((c): c is Record<string, 'asc' | 'desc'> => c !== null);
    if (clauses.length) orderBy = clauses;
  }

  return {
    where,
    orderBy: withTiebreaker(orderBy),
    ...normalizePageParams(query.page, query.pageSize),
  };
}
