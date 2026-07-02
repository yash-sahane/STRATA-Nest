import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@lt/prisma';
import type { User, WorkspaceMember } from '@prisma/client';
import { permissionsForRole, type PermissionKey } from './permissions';

const DENY_MESSAGE = 'You do not have permission to perform this action.'; // DRF parity

/**
 * The reusable workspace authorization layer every domain module depends on.
 * Reproduces the Django base viewset's membership scoping (A§4.6) and adds
 * policy-based RBAC (ADR-0005). `RBAC_ENFORCED=false` keeps a membership-only
 * floor (dark-launch parity); `true` enforces per-permission checks on writes.
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

  async can(user: User, workspaceId: string, permission: PermissionKey): Promise<boolean> {
    const set = await this.permissions(user, workspaceId);
    return set.has('*') || set.has(permission);
  }

  /** Enforce a write. RBAC off → membership-only floor; RBAC on → require the permission. */
  async assertPermission(user: User, workspaceId: string, permission: PermissionKey): Promise<void> {
    if (this.isPlatformAdmin(user)) return;
    if (!this.config.get<boolean>('RBAC_ENFORCED', false)) {
      return this.assertMember(user, workspaceId);
    }
    if (!(await this.can(user, workspaceId, permission))) {
      throw new ForbiddenException(DENY_MESSAGE);
    }
  }
}
