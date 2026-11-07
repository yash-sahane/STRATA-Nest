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

  describe('two predicates on one field', () => {
    it('ANDs a suffixed key onto an equality instead of replacing it (scope bypass)', () => {
      const { where } = parseListQuery({ workspaceId: 'A', workspaceId__ne: 'x' }, spec);
      expect(where).toEqual({ workspaceId: 'A', AND: [{ workspaceId: { not: 'x' } }] });
    });

    it('keeps the equality whichever key arrives first', () => {
      const { where } = parseListQuery({ workspaceId__in: 'B', workspaceId: 'A' }, spec);
      expect(where).toEqual({ workspaceId: { in: ['B'] }, AND: [{ workspaceId: 'A' }] });
    });

    it('ANDs operator objects that share a key (a repeated equality vs __in)', () => {
      const { where } = parseListQuery({ workspaceId: ['A', 'A'], workspaceId__in: 'B' }, spec);
      expect(where).toEqual({
        workspaceId: { in: ['A', 'A'] },
        AND: [{ workspaceId: { in: ['B'] } }],
      });
    });

    it('does not lose a falsy equality', () => {
      const { where } = parseListQuery({ archived: 'false', archived__ne: 'true' }, spec);
      expect(where).toEqual({ archived: false, AND: [{ archived: { not: true } }] });
    });

    it('does not spread a date equality into an empty object', () => {
      const { where } = parseListQuery(
        { createdAt: '2026-01-01T00:00:00.000Z', createdAt__gte: '2025-01-01T00:00:00.000Z' },
        spec,
      );
      expect(where).toEqual({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        AND: [{ createdAt: { gte: new Date('2025-01-01T00:00:00.000Z') } }],
      });
    });
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
      { id: 'asc' },
    ]);
    // unknown sort field is dropped, falling back to default
    expect(parseListQuery({ ordering: 'evil' }, spec).orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  describe('a total order, so OFFSET pages neither repeat nor skip a row', () => {
    it('ends every order with id: the default, and one the client asked for', () => {
      expect(parseListQuery({}, spec).orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
      expect(parseListQuery({ ordering: 'title' }, spec).orderBy).toEqual([
        { title: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('does not add id to an order that already has it', () => {
      const withId: ListQuerySpec = {
        ...spec,
        sortable: { ...spec.sortable, id: 'id' },
        defaultOrderBy: [{ createdAt: 'asc' }, { id: 'desc' }],
      };
      expect(parseListQuery({}, withId).orderBy).toEqual([{ createdAt: 'asc' }, { id: 'desc' }]);
      expect(parseListQuery({ ordering: '-id' }, withId).orderBy).toEqual([{ id: 'desc' }]);
    });

    it('leaves the spec’s own default untouched', () => {
      const defaults: ListQuerySpec = { ...spec, defaultOrderBy: [{ title: 'asc' }] };
      parseListQuery({}, defaults);
      expect(defaults.defaultOrderBy).toEqual([{ title: 'asc' }]);
    });
  });

  it('clamps pagination', () => {
    const r = parseListQuery({ page: '3', pageSize: '5000' }, spec);
    expect(r).toMatchObject({ page: 3, pageSize: 1000, skip: 2000, take: 1000 });
  });

  describe('unknown-key diagnostics', () => {
    const originalEnv = process.env.NODE_ENV;
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
      process.env.NODE_ENV = originalEnv;
    });

    it('stays silent outside development (prod log noise / test output)', () => {
      for (const env of ['production', 'test']) {
        process.env.NODE_ENV = env;
        parseListQuery({ inviteCode: 'ABC', ordering: 'evil' }, spec);
      }
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns in development for unknown filter and sort keys', () => {
      process.env.NODE_ENV = 'development';
      const { where, orderBy } = parseListQuery({ inviteCode: 'ABC', ordering: 'evil' }, spec);

      // The dropping behaviour itself is unchanged — the warn is diagnostic only.
      expect(where).toEqual({});
      expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);

      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('inviteCode');
      expect(messages[1]).toContain('evil');
    });

    it('does not warn for reserved pagination/ordering keys', () => {
      process.env.NODE_ENV = 'development';
      parseListQuery({ page: '2', pageSize: '10', q: 'x', status: 'ACTIVE' }, spec);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe('parseListQuery — search and list fields', () => {
  const spec = {
    filterable: { assigneeId: { field: 'assigneeIds', type: 'json-array' as const } },
    sortable: {},
    search: ['title', 'hierarchyId'],
  };

  it('q searches every search field, case-insensitively', () => {
    const { where } = parseListQuery({ q: ' Login ' }, spec);
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { title: { contains: 'Login', mode: 'insensitive' } },
            { hierarchyId: { contains: 'Login', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('q is ignored by a resource that names no search fields', () => {
    expect(parseListQuery({ q: 'x' }, { filterable: {}, sortable: {} }).where).toEqual({});
  });

  it('a json-array filter asks the list to hold the value', () => {
    expect(parseListQuery({ assigneeId: 'u1' }, spec).where).toEqual({
      assigneeIds: { array_contains: ['u1'] },
    });
  });
});
