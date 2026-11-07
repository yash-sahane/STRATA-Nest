import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User, WorkspaceMember } from '@prisma/client';
import { capabilitiesOrphaned, type AdministrationChange } from './administration';
import {
  BASELINE_PERMISSIONS,
  PERMISSION_KEYS,
  Permission,
  ROLE_PERMISSIONS,
  isBuiltInRole,
  permissionsForRole,
  type PermissionKey,
} from './permissions';

export const DENY_MESSAGE = 'You do not have permission to perform this action.'; // frozen error string — clients match on this exact text

/** Destructive AND privilege-granting operations that always run the real
 *  permission check, even when `RBAC_ENFORCED=false` relaxes ordinary writes to
 *  the membership floor. Granting access or a role is an escalation vector, so
 *  the relaxed floor must never cover it. */
const ALWAYS_ENFORCED: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  Permission.WorkspaceDelete,
  Permission.ProjectDelete,
  Permission.MemberInvite,
  Permission.MemberUpdate,
  Permission.MemberRemove,
  Permission.RoleManage,
  Permission.InviteManage,
  Permission.JoinManage,
]);

/**
 * The reusable workspace authorization layer every domain module depends on.
 * Provides membership scoping plus policy-based RBAC.
 * `RBAC_ENFORCED=false` keeps a membership-only floor; `true` (the default)
 * enforces per-permission checks on writes. Destructive operations are always
 * permission-checked regardless of the flag.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isPlatformAdmin(user: User): boolean {
    return user.isSuperuser || user.isAdminFlag;
  }

  /** ACTIVE workspace ids for a user; `null` means "all" (platform admin). */
  async accessibleWorkspaceIds(user: User): Promise<string[] | null> {
    if (this.isPlatformAdmin(user)) return null;
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { workspaceId: true },
    });
    return rows.map((r) => r.workspaceId);
  }

  /** Prisma where-fragment scoping a collection to accessible workspaces.
   *  `field` is the workspace-id column; use `'id'` for the Workspace model itself. */
  async scopeWhere(user: User, field = 'workspaceId'): Promise<Record<string, unknown>> {
    const ids = await this.accessibleWorkspaceIds(user);
    if (ids === null) return {};
    return { [field]: { in: ids } };
  }

  activeMembership(userId: string, workspaceId: string): Promise<WorkspaceMember | null> {
    return this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId, status: 'ACTIVE' },
    });
  }

  async assertMember(user: User, workspaceId: string): Promise<void> {
    if (this.isPlatformAdmin(user)) return;
    if (!(await this.activeMembership(user.id, workspaceId))) {
      throw new ForbiddenException(DENY_MESSAGE);
    }
  }

  /** The caller's effective permission set in a workspace (`*` = all, for admins). */
  async permissions(user: User, workspaceId: string): Promise<Set<string>> {
    if (this.isPlatformAdmin(user)) return new Set(['*']);
    const membership = await this.activeMembership(user.id, workspaceId);
    if (!membership) return new Set();
    // A built-in role is the static map: no custom-role read on every check.
    return this.permissionsOfRole(workspaceId, membership.role);
  }

  /**
   * Every ACTIVE membership the caller holds, with its role and the permission
   * keys it carries — implied keys included, as every check here resolves them.
   * One membership read and at most one custom-role read, whatever the number
   * of workspaces: the browser asks this once and answers every "may I?" from it.
   */
  async myAccess(user: User): Promise<{
    platformAdmin: boolean;
    workspaces: Array<{ workspaceId: string; role: string; permissions: string[] }>;
  }> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { workspaceId: true, role: true },
    });
    const custom = memberships.filter((m) => !isBuiltInRole(m.role));
    const definitions = custom.length
      ? await this.prisma.workspaceRole.findMany({
          where: { OR: custom.map((m) => ({ workspaceId: m.workspaceId, name: m.role })) },
          select: { workspaceId: true, name: true, permissions: true },
        })
      : [];
    const keysOf = new Map(
      definitions.map((d) => [
        `${d.workspaceId}\u0000${d.name}`,
        Array.isArray(d.permissions) ? (d.permissions as string[]) : undefined,
      ]),
    );
    return {
      platformAdmin: this.isPlatformAdmin(user),
      workspaces: memberships.map((m) => ({
        workspaceId: m.workspaceId,
        role: m.role,
        permissions: [
          ...permissionsForRole(m.role, keysOf.get(`${m.workspaceId}\u0000${m.role}`)),
        ],
      })),
    };
  }

  /** Reject role names that are neither built-in nor a custom WorkspaceRole of
   *  this workspace — an unknown role would silently fall to the read-only floor.
   *  Every membership-writing path (members, invites, invite codes) uses this.
   *  `isBuiltInRole` is an own-property test: a plain `ROLE_PERMISSIONS[role]`
   *  lookup admitted "constructor"/"toString"/"__proto__". */
  async assertValidRole(workspaceId: string, role: string): Promise<void> {
    if (isBuiltInRole(role)) return;
    const custom = await this.prisma.workspaceRole.findFirst({
      where: { workspaceId, name: role },
      select: { id: true },
    });
    if (!custom) {
      throw new BadRequestException(`Unknown role "${role}" for this workspace.`);
    }
  }

  /** The permission set a ROLE NAME resolves to in a workspace, independent of
   *  who holds it — built-in map first (a custom row of the same name is inert,
   *  which is why `assertNotBuiltIn` rejects it), else the custom role's JSON,
   *  else the read-only floor. */
  async permissionsOfRole(workspaceId: string, role: string): Promise<Set<string>> {
    if (isBuiltInRole(role)) return permissionsForRole(role);
    const custom = await this.prisma.workspaceRole.findFirst({
      where: { workspaceId, name: role },
      select: { permissions: true },
    });
    const perms =
      custom && Array.isArray(custom.permissions) ? (custom.permissions as string[]) : undefined;
    return permissionsForRole(role, perms);
  }

  /**
   * The permissions `role` carries that the caller does not hold themselves.
   *
   * The baseline is left out: every membership has it, so handing it over
   * raises nobody. Unrecognised keys in a stored custom role are ignored for the
   * same reason `assertNoEscalation` ignores them — they name no capability.
   */
  private async permissionsBeyondOwn(
    user: User,
    workspaceId: string,
    role: string,
    // The caller's own set, when it has already been read for several roles.
    own?: Set<string>,
  ): Promise<string[]> {
    if (this.isPlatformAdmin(user)) return [];
    const held = own ?? (await this.permissions(user, workspaceId));
    if (held.has('*')) return [];
    const carried = await this.permissionsOfRole(workspaceId, role);
    return [...carried].filter(
      (p) => PERMISSION_KEYS.has(p) && !BASELINE_PERMISSIONS.has(p) && !held.has(p),
    );
  }

  /**
   * Nobody hands out a role that can do more than they can.
   *
   * `member:invite`, `member:update` and `invite:manage` each decide what role
   * somebody ELSE holds, and every one of them accepted any role the workspace
   * defines. An ASSISTANT_MANAGER — everything but `workspace:delete` — could
   * promote a colleague to MANAGER, or invite a second address of their own as
   * one, and so reach the single permission the role exists to withhold. A
   * custom role holding nothing but `member:invite` could mint a MANAGER the
   * same way. Same rule the role DEFINITIONS already follow (`assertNoEscalation`
   * in WorkspaceRolesService), applied where a role is assigned.
   */
  async assertCanGrantRole(user: User, workspaceId: string, role: string): Promise<void> {
    if ((await this.permissionsBeyondOwn(user, workspaceId, role)).length) {
      throw new ForbiddenException(
        `You cannot give someone the "${role}" role: it can do more than your own.`,
      );
    }
  }

  /**
   * The role names in a workspace that the caller could hand to somebody —
   * every built-in and custom role that passes `assertCanGrantRole`. `null`
   * means "all of them" (a platform admin).
   */
  async grantableRoles(user: User, workspaceId: string): Promise<string[] | null> {
    if (this.isPlatformAdmin(user)) return null;
    const custom = await this.prisma.workspaceRole.findMany({
      where: { workspaceId },
      select: { name: true },
    });
    const names = [...new Set([...Object.keys(ROLE_PERMISSIONS), ...custom.map((r) => r.name)])];
    const own = await this.permissions(user, workspaceId);
    const beyond = await Promise.all(
      names.map((name) => this.permissionsBeyondOwn(user, workspaceId, name, own)),
    );
    return names.filter((_, i) => beyond[i].length === 0);
  }

  /**
   * The same rule read the other way: a member whose role can do more than the
   * caller's is not the caller's to demote, deactivate, reactivate or remove.
   */
  async assertNotOutranked(user: User, workspaceId: string, role: string): Promise<void> {
    if (await this.outranked(user, workspaceId, role)) {
      throw new ForbiddenException(
        'You cannot change or remove a member whose role can do more than your own.',
      );
    }
  }

  /** Whether `role` can do something in this workspace that the caller cannot. */
  async outranked(user: User, workspaceId: string, role: string): Promise<boolean> {
    return (await this.permissionsBeyondOwn(user, workspaceId, role)).length > 0;
  }

  /**
   * The ACTIVE members of a workspace whose role carries `permission` — the
   * people a "this needs a decision" notification is for. Resolved the way every
   * check resolves it, so a custom role counts and a role name does not.
   * Platform admins are not listed: they hold no membership to be found by.
   */
  async membersHolding(workspaceId: string, permission: PermissionKey): Promise<string[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      select: { userId: true, role: true },
    });
    const holds = new Map<string, boolean>();
    for (const role of new Set(members.map((m) => m.role))) {
      holds.set(role, (await this.permissionsOfRole(workspaceId, role)).has(permission));
    }
    return members.filter((m) => holds.get(m.role)).map((m) => m.userId);
  }

  /**
   * The administrative capabilities `change` would leave this workspace with no
   * ACTIVE holder of — empty when it is safe.
   *
   * The one invariant every write that takes power away runs: a membership's
   * role change, switch-off, removal or leaving, a custom role's new permission
   * list, and an account being deactivated. It is evaluated against the state
   * the write WILL leave, from the same rows the write is about to change.
   * `db` lets a caller ask inside its own transaction.
   */
  async capabilitiesOrphanedBy(
    workspaceId: string,
    change: AdministrationChange,
    db: Pick<Prisma.TransactionClient, 'workspaceMember' | 'workspaceRole'> = this.prisma,
  ): Promise<PermissionKey[]> {
    const [members, custom] = await Promise.all([
      db.workspaceMember.findMany({
        where: { workspaceId, status: 'ACTIVE' },
        select: { id: true, role: true },
      }),
      db.workspaceRole.findMany({
        where: { workspaceId },
        select: { name: true, permissions: true },
      }),
    ]);
    const definitions = new Map(
      custom.map((r) => [
        r.name,
        Array.isArray(r.permissions) ? (r.permissions as string[]) : undefined,
      ]),
    );
    return capabilitiesOrphaned({ members, definitions }, change);
  }

  async can(user: User, workspaceId: string, permission: PermissionKey): Promise<boolean> {
    const set = await this.permissions(user, workspaceId);
    return set.has('*') || set.has(permission);
  }

  /** Enforce a write. RBAC off → membership-only floor (except destructive
   *  operations, which always require the permission); RBAC on → require the permission. */
  async assertPermission(user: User, workspaceId: string, permission: PermissionKey): Promise<void> {
    if (this.isPlatformAdmin(user)) return;
    if (!this.config.get<boolean>('RBAC_ENFORCED', true) && !ALWAYS_ENFORCED.has(permission)) {
      return this.assertMember(user, workspaceId);
    }
    if (!(await this.can(user, workspaceId, permission))) {
      throw new ForbiddenException(DENY_MESSAGE);
    }
  }
}
