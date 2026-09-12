import { Permission, isBuiltInRole, permissionsForRole } from './permissions';

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

  it('MEMBER baseline: all reads + own HR writes, no manager writes/approvals', () => {
    const set = permissionsForRole('MEMBER');
    expect([...set].sort()).toEqual(
      [
        Permission.MemberRead,
        Permission.WorkspaceRead,
        Permission.ProjectRead,
        Permission.RequirementRead,
        Permission.PlanningRead,
        Permission.TaskRead,
        Permission.HrRead,
        Permission.HrWrite,
        Permission.NotificationRead,
        Permission.NotificationWrite,
        Permission.ActivityRead,
        Permission.ActivityWrite,
        Permission.FileRead,
        Permission.IntegrationRead,
      ].sort(),
    );
    expect(set.has(Permission.ProjectCreate)).toBe(false);
    expect(set.has(Permission.TaskWrite)).toBe(false);
    // MEMBER is the read-only observer role. With file:write it could upload
    // into any project it could see and delete ANY file in the workspace,
    // including one a manager had uploaded.
    expect(set.has(Permission.FileWrite)).toBe(false);
    expect(set.has(Permission.LeaveApprove)).toBe(false); // members can't approve leave
    expect(set.has(Permission.TimeApprove)).toBe(false);
    expect(set.has(Permission.IntegrationWrite)).toBe(false); // integrations hold tokens
  });

  it('the delivery roles keep file:write — they attach mockups and specs', () => {
    for (const role of ['SOFTWARE_DEVELOPER', 'TESTER', 'DEVELOPER_INTERN', 'CONTENT_ENGINEER']) {
      expect(permissionsForRole(role).has(Permission.FileWrite)).toBe(true);
    }
    expect(permissionsForRole('MANAGER').has(Permission.FileWrite)).toBe(true);
  });

  it('MANAGER can approve leave and time; ASSISTANT_MANAGER too', () => {
    expect(permissionsForRole('MANAGER').has(Permission.LeaveApprove)).toBe(true);
    expect(permissionsForRole('ASSISTANT_MANAGER').has(Permission.TimeApprove)).toBe(true);
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

/**
 * Role names arrive as caller-supplied strings. On a plain object literal,
 * `ROLE_PERMISSIONS['constructor' | 'toString' | '__proto__']` resolves to an
 * INHERITED member, so every truthiness test on that lookup accepted the name
 * as a built-in role — and the resulting `new Set(Object)` threw
 * "function is not iterable", i.e. a 500 on every RBAC-checked route in the
 * workspace, for a value the validation layer had just waved through.
 */
describe('Object.prototype keys are not roles', () => {
  const prototypeKeys = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];

  it('isBuiltInRole rejects every inherited key', () => {
    for (const key of prototypeKeys) expect(isBuiltInRole(key)).toBe(false);
    expect(isBuiltInRole('MANAGER')).toBe(true);
  });

  it('permissionsForRole resolves them to the read-only floor rather than throwing', () => {
    for (const key of prototypeKeys) {
      const set = permissionsForRole(key);
      expect(set.has(Permission.WorkspaceRead)).toBe(true);
      expect(set.has(Permission.MemberInvite)).toBe(false);
    }
  });
});
