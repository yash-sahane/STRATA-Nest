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
        Permission.FileWrite,
        Permission.IntegrationRead,
      ].sort(),
    );
    expect(set.has(Permission.ProjectCreate)).toBe(false);
    expect(set.has(Permission.TaskWrite)).toBe(false);
    expect(set.has(Permission.LeaveApprove)).toBe(false); // members can't approve leave
    expect(set.has(Permission.TimeApprove)).toBe(false);
    expect(set.has(Permission.IntegrationWrite)).toBe(false); // integrations hold tokens
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
