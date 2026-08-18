export interface QueryOp {
  op:
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'search'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull'
  | 'between'
  | 'in'
  | 'notIn'
  | 'order'
  | 'limit'
  | 'offset'
  | 'or';
  k?: string;
  v?: unknown;
  dir?: 'asc' | 'desc';
  n?: number;
  clauses?: QueryOp[];
}

export type QueryInput = QueryOp | string;

const makeQuery = (op: QueryOp['op'], k?: string, v?: unknown): QueryOp => ({ op, k, v });

export const query = {
  equal: (k: string, v: unknown) => makeQuery('eq', k, v),
  notEqual: (k: string, v: unknown) => makeQuery('ne', k, v),
  lessThan: (k: string, v: unknown) => makeQuery('lt', k, v),
  lessThanEqual: (k: string, v: unknown) => makeQuery('lte', k, v),
  greaterThan: (k: string, v: unknown) => makeQuery('gt', k, v),
  greaterThanEqual: (k: string, v: unknown) => makeQuery('gte', k, v),
  contains: (k: string, v: unknown) => makeQuery('contains', k, v),
  search: (k: string, v: string) => makeQuery('search', k, v),
  startsWith: (k: string, v: string) => makeQuery('startsWith', k, v),
  endsWith: (k: string, v: string) => makeQuery('endsWith', k, v),
  isNull: (k: string) => makeQuery('isNull', k),
  isNotNull: (k: string) => makeQuery('isNotNull', k),
  between: (k: string, lo: unknown, hi: unknown): QueryOp => ({ op: 'between', k, v: [lo, hi] }),
  in: (k: string, v: unknown[]): QueryOp => ({ op: 'in', k, v }),
  notIn: (k: string, v: unknown[]): QueryOp => ({ op: 'notIn', k, v }),
  orderAsc: (k: string): QueryOp => ({ op: 'order', k, dir: 'asc' }),
  orderDesc: (k: string): QueryOp => ({ op: 'order', k, dir: 'desc' }),
  limit: (n: number): QueryOp => ({ op: 'limit', n }),
  offset: (n: number): QueryOp => ({ op: 'offset', n }),
  or: (clauses: QueryOp[]): QueryOp => ({ op: 'or', clauses }),
};

const ID_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function nativeId(): string {
  let value = '';
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  for (let index = 0; index < bytes.length; index += 1) {
    value += ID_ALPHA[bytes[index] % ID_ALPHA.length];
  }
  return value;
}

export const id = {
  unique: nativeId,
  custom: (value: string) => value,
};

function appendValue(out: Array<[string, string]>, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((item) => out.push([key, String(item)]));
    return;
  }
  if (value !== undefined && value !== null) out.push([key, String(value)]);
}

export function translateQueries(queries: QueryInput[] = []): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const item of queries) {
    if (!item) continue;
    if (typeof item === 'string') {
      const [key, ...rest] = item.split('=');
      if (key && rest.length > 0) out.push([key, rest.join('=')]);
      continue;
    }
    const key = item.k;
    switch (item.op) {
      case 'eq':
      case 'in':
        if (key) appendValue(out, key, item.v);
        break;
      case 'ne':
        if (key) appendValue(out, `${key}__ne`, item.v);
        break;
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        if (key) appendValue(out, `${key}__${item.op}`, item.v);
        break;
      case 'contains':
      case 'search':
        if (key) appendValue(out, `${key}__icontains`, item.v);
        break;
      case 'startsWith':
        if (key) out.push([`${key}__istartswith`, String(item.v ?? '')]);
        break;
      case 'endsWith':
        if (key) out.push([`${key}__iendswith`, String(item.v ?? '')]);
        break;
      case 'isNull':
        if (key) out.push([`${key}__isnull`, 'true']);
        break;
      case 'isNotNull':
        if (key) out.push([`${key}__isnull`, 'false']);
        break;
      case 'between':
        if (key && Array.isArray(item.v) && item.v.length >= 2) {
          appendValue(out, `${key}__gte`, item.v[0]);
          appendValue(out, `${key}__lte`, item.v[1]);
        }
        break;
      case 'notIn':
        if (key) appendValue(out, `${key}__not_in`, item.v);
        break;
      case 'order':
        if (key) out.push(['ordering', `${item.dir === 'desc' ? '-' : ''}${key}`]);
        break;
      case 'limit':
        if (item.n !== undefined) out.push(['pageSize', String(item.n)]);
        break;
      case 'offset':
      case 'or':
        break;
      default:
        break;
    }
  }
  return out;
}
