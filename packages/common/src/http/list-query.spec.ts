import { parseListQuery, type ListQuerySpec } from './list-query';

const spec: ListQuerySpec = {
  filterable: {
    status: { field: 'status' },
    priority: { field: 'priority' },
    workspaceId: { field: 'workspaceId' },
    progress: { field: 'progress', type: 'number' },
    archived: { field: 'archived', type: 'boolean' },
    createdAt: { field: 'createdAt', type: 'date' },
  },
  sortable: { createdAt: 'createdAt', title: 'title' },
  defaultOrderBy: { createdAt: 'desc' },
};

describe('parseListQuery (allowlisted field filter)', () => {
  it('maps simple equality', () => {
    const { where } = parseListQuery({ status: 'ACTIVE' }, spec);
    expect(where).toEqual({ status: 'ACTIVE' });
  });

  it('ignores fields not in the allowlist (security)', () => {
    const { where } = parseListQuery({ password: 'x', secretField: 'y' }, spec);
    expect(where).toEqual({});
  });

  it('expands comma lists into `in`', () => {
    const { where } = parseListQuery({ status: 'TODO,IN_PROGRESS' }, spec);
    expect(where).toEqual({ status: { in: ['TODO', 'IN_PROGRESS'] } });
  });

  it('supports __ne / __not_in', () => {
    expect(parseListQuery({ status__ne: 'DONE' }, spec).where).toEqual({ status: { not: 'DONE' } });
    expect(parseListQuery({ status__not_in: 'A,B' }, spec).where).toEqual({
      status: { notIn: ['A', 'B'] },
    });
  });

  it('merges range operators on one field with coercion', () => {
    const { where } = parseListQuery({ progress__gte: '20', progress__lte: '80' }, spec);
    expect(where).toEqual({ progress: { gte: 20, lte: 80 } });
  });

  it('handles icontains (case-insensitive)', () => {
    expect(parseListQuery({ status__icontains: 'act' }, spec).where).toEqual({
      status: { contains: 'act', mode: 'insensitive' },
    });
  });

  it('handles isnull', () => {
    expect(parseListQuery({ priority__isnull: 'true' }, spec).where).toEqual({
      priority: { equals: null },
    });
    expect(parseListQuery({ priority__isnull: 'false' }, spec).where).toEqual({
      priority: { not: null },
    });
  });

  it('coerces booleans', () => {
    expect(parseListQuery({ archived: 'true' }, spec).where).toEqual({ archived: true });
  });

  it('parses ordering with allowlist + direction', () => {
    expect(parseListQuery({ ordering: '-createdAt,title' }, spec).orderBy).toEqual([
      { createdAt: 'desc' },
      { title: 'asc' },
    ]);
    // unknown sort field is dropped, falling back to default
    expect(parseListQuery({ ordering: 'evil' }, spec).orderBy).toEqual({ createdAt: 'desc' });
  });

  it('clamps pagination', () => {
    const r = parseListQuery({ page: '3', pageSize: '5000' }, spec);
    expect(r).toMatchObject({ page: 3, pageSize: 1000, skip: 2000, take: 1000 });
  });
});
