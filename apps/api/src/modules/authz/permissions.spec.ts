import { Permission, permissionsForRole } from './permissions';

describe('permissionsForRole', () => {
  it('MANAGER has every permission (incl. workspace:delete)', () => {
    const set = permissionsForRole('MANAGER');
    expect(set.has(Permission.WorkspaceDelete)).toBe(true);
    expect(set.size).toBe(Object.keys(Permission).length);
  });

  it('ASSISTANT_MANAGER has everything except workspace:delete', () => {
    const set = permissionsForRole('ASSISTANT_MANAGER');
    expect(set.has(Permission.WorkspaceDelete)).toBe(false);
    expect(set.has(Permission.MemberInvite)).toBe(true);
  });

  it('MEMBER is read-only (all *:read, no writes)', () => {
    const set = permissionsForRole('MEMBER');
    expect([...set].sort()).toEqual(
      [
        Permission.MemberRead,
        Permission.WorkspaceRead,
        Permission.ProjectRead,
        Permission.RequirementRead,
        Permission.PlanningRead,
        Permission.TaskRead,
      ].sort(),
    );
    expect(set.has(Permission.ProjectCreate)).toBe(false);
    expect(set.has(Permission.RequirementWrite)).toBe(false);
    expect(set.has(Permission.PlanningWrite)).toBe(false);
    expect(set.has(Permission.TaskWrite)).toBe(false);
  });

  it('a custom role uses its JSON permissions', () => {
    const set = permissionsForRole('CUSTOM', ['workspace:read', 'role:manage']);
    expect(set.has('role:manage')).toBe(true);
    expect(set.has(Permission.MemberRemove)).toBe(false);
  });

  it('unknown role without custom perms falls back to read-only', () => {
    const set = permissionsForRole('WHATEVER');
    expect(set.has(Permission.WorkspaceRead)).toBe(true);
    expect(set.has(Permission.MemberInvite)).toBe(false);
  });
});
