import { Permission, isBuiltInRole, permissionsForRole, type PermissionKey } from './permissions';

/**
 * The capabilities a workspace must never lose its last ACTIVE holder of.
 *
 * `member:update` alone was not enough: MANAGER → ASSISTANT_MANAGER keeps it
 * (ASSISTANT_MANAGER is `ALL` minus `workspace:delete`), so a role change that
 * strips the workspace of every actor able to delete it read as "no capacity
 * lost" and skipped both the owner guard and the last-admin count. Tracking
 * `workspace:delete` separately makes the demotion of the last MANAGER — and of
 * the owner — visible as the privilege loss it is.
 */
export const ADMIN_CAPABILITIES: readonly PermissionKey[] = [
  Permission.MemberUpdate,
  Permission.WorkspaceDelete,
];

/** What each capability lets somebody do, for a refusal a person reads. */
const CAPABILITY_PHRASES: Readonly<Record<string, string>> = {
  [Permission.MemberUpdate]: 'change members’ roles and access',
  [Permission.WorkspaceDelete]: 'delete the workspace',
};

/** "change members’ roles and access, or delete the workspace". */
export function describeCapabilities(capabilities: readonly PermissionKey[]): string {
  return capabilities.map((p) => CAPABILITY_PHRASES[p] ?? p).join(', or ');
}

/**
 * One change to who can do what in a workspace, described BEFORE it is written.
 *
 * Membership writes and role-definition writes used to be guarded separately,
 * and only the first was: re-pointing the owner onto a custom role cost nothing
 * on paper, and cutting that role down afterwards was not a membership change
 * at all — so the pair stripped the owner, and could leave the workspace with
 * nobody able to administer it, without either guard noticing.
 */
export type AdministrationChange =
  /** A membership moves to another role or — `role: null` — stops counting:
   *  removed, left, or switched off. */
  | { membershipId: string; role: string | null }
  /** A custom role is given a new permission list. */
  | { roleName: string; permissions: string[] };

export interface AdministrationState {
  /** The workspace's ACTIVE memberships — the only ones that authorize anything. */
  members: ReadonlyArray<{ id: string; role: string }>;
  /** Its custom roles' stored permission lists, by name. */
  definitions: ReadonlyMap<string, string[] | undefined>;
}

/**
 * The ADMIN_CAPABILITIES the workspace has an ACTIVE holder of now and would
 * have none of once `change` is applied.
 *
 * Both sides are resolved the way every permission check resolves them — the
 * built-in map, else the custom role's list, else the read-only floor — so a
 * role name proves nothing and a custom role counts. Only capabilities that are
 * held NOW can be lost: a workspace that already has no administrator (a legacy
 * import) is not frozen by this, and repairing it stays possible.
 */
export function capabilitiesOrphaned(
  state: AdministrationState,
  change: AdministrationChange,
): PermissionKey[] {
  const capabilitiesOfRole = (role: string, after: boolean): PermissionKey[] => {
    const redefined =
      after && 'roleName' in change && change.roleName === role && !isBuiltInRole(role);
    const set = permissionsForRole(
      role,
      redefined ? change.permissions : state.definitions.get(role),
    );
    return ADMIN_CAPABILITIES.filter((p) => set.has('*') || set.has(p));
  };
  const heldBy = (roles: string[], after: boolean): Set<PermissionKey> =>
    new Set([...new Set(roles)].flatMap((role) => capabilitiesOfRole(role, after)));

  const before = heldBy(
    state.members.map((m) => m.role),
    false,
  );
  const after = heldBy(
    state.members.flatMap((m) => {
      if (!('membershipId' in change) || m.id !== change.membershipId) return [m.role];
      return change.role === null ? [] : [change.role];
    }),
    true,
  );
  return ADMIN_CAPABILITIES.filter((p) => before.has(p) && !after.has(p));
}
