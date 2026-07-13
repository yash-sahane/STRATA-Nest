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
export type FieldType = 'string' | 'number' | 'boolean' | 'date';

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

const RESERVED = new Set(['page', 'pageSize', 'page_size', 'ordering', 'format']);

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

export function parseListQuery(
  query: Record<string, string | string[] | undefined>,
  spec: ListQuerySpec,
): ParsedListQuery {
  const where: Record<string, unknown> = {};

  for (const [rawKey, rawVal] of Object.entries(query)) {
    if (RESERVED.has(rawKey)) continue;
    const [apiKey, suffix] = rawKey.split('__', 2);
    const fieldSpec = spec.filterable[apiKey];
    if (!fieldSpec) continue; // ALLOWLIST — silently ignore unknown fields

    const values = asArray(rawVal);
    if (values.length === 0 && suffix !== 'isnull') continue;

    const op = suffix ?? (values.length > 1 ? 'in' : 'eq');
    const clause = buildClause(op, values, fieldSpec.type);

    // Merge object clauses on the same field (e.g. createdAt__gte + createdAt__lte → range).
    const existing = where[fieldSpec.field];
    if (existing && typeof existing === 'object' && typeof clause === 'object' && clause !== null) {
      where[fieldSpec.field] = { ...(existing as object), ...(clause as object) };
    } else {
      where[fieldSpec.field] = clause;
    }
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
        return field ? { [field]: (desc ? 'desc' : 'asc') as 'asc' | 'desc' } : null;
      })
      .filter((c): c is Record<string, 'asc' | 'desc'> => c !== null);
    if (clauses.length) orderBy = clauses;
  }

  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(
    1000,
    Math.max(1, Number.parseInt(String(query.pageSize ?? '100'), 10) || 100),
  );

  return { where, orderBy, page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
