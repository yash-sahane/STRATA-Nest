import { HierarchyIdService, bumpHierarchyId, isHierarchyIdConflict } from './hierarchy-id.service';

const H = new HierarchyIdService();

/** Real Prisma errors aren't constructible without a client; the detector duck-types them. */
function prismaError(code: string, target?: unknown) {
  const e = new Error('prisma') as Error & { code: string; meta?: { target?: unknown } };
  e.code = code;
  if (target !== undefined) e.meta = { target };
  Object.defineProperty(e, 'constructor', { value: { name: 'PrismaClientKnownRequestError' } });
  return e;
}

describe('HierarchyIdService', () => {
  it('extractChars strips non-letters, takes N, uppercases', () => {
    expect(H.extractChars('User Auth 2!', 3)).toBe('USE');
    expect(H.extractChars('a1b2c3', 3)).toBe('ABC');
    expect(H.extractChars('', 3)).toBe('');
    expect(H.extractChars('12 34', 3)).toBe('');
  });

  it('pad2 zero-pads to two digits, passes through larger', () => {
    expect(H.pad2(1)).toBe('01');
    expect(H.pad2(9)).toBe('09');
    expect(H.pad2(10)).toBe('10');
    expect(H.pad2(100)).toBe('100');
  });

  it('bumpHierarchyId increments the trailing segment, preserving its padding', () => {
    expect(bumpHierarchyId('PROJ-USE-LOG-API-01')).toBe('PROJ-USE-LOG-API-02');
    expect(bumpHierarchyId('PROJ-USE-LOG-API-09')).toBe('PROJ-USE-LOG-API-10');
    expect(bumpHierarchyId('PROJ-USE-LOG-API-99')).toBe('PROJ-USE-LOG-API-100'); // never truncates
    expect(bumpHierarchyId('PROJ-USE-LOG-API-01.09')).toBe('PROJ-USE-LOG-API-01.10'); // dotted child
    expect(bumpHierarchyId('PROJ-FR')).toBe('PROJ-FR-01'); // no numeric tail: give it one
    expect(H.bump('PROJ-FR-01')).toBe('PROJ-FR-02'); // same rule through the service
  });

  it('isHierarchyIdConflict matches only a P2002 on the hierarchy id', () => {
    expect(isHierarchyIdConflict(prismaError('P2002', ['project_id', 'hierarchy_id']))).toBe(true);
    expect(isHierarchyIdConflict(prismaError('P2002'))).toBe(true); // no target: only unique key
    expect(isHierarchyIdConflict(prismaError('P2002', ['workspace_id', 'short_code']))).toBe(false);
    expect(isHierarchyIdConflict(prismaError('P2003'))).toBe(false); // FK, not unique
    expect(isHierarchyIdConflict(new Error('db is down'))).toBe(false);
    expect(isHierarchyIdConflict(undefined)).toBe(false);
  });

});
