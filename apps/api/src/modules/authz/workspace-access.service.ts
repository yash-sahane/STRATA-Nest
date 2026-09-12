import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@strata/prisma';
import type { User, WorkspaceMember } from '@prisma/client';
import { Permission, isBuiltInRole, permissionsForRole, type PermissionKey } from './permissions';

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
    let custom: string[] | undefined;
    const role = await this.prisma.workspaceRole.findFirst({
      where: { workspaceId, name: membership.role },
      select: { permissions: true },
    });
    if (role && Array.isArray(role.permissions)) custom = role.permissions as string[];
    return permissionsForRole(membership.role, custom);
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
