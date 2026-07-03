import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@lt/prisma';
import type { User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';

/**
 * Scopes the integration collections by the project→workspace relation (the
 * Django tables have no workspace column, so the base viewset never scoped them
 * — the D5 gap). Here, a user only sees integrations/commits for projects in
 * their ACTIVE workspaces; admins see all.
 */
@Injectable()
export class IntegrationAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Project ids the caller may see; `null` = all (platform admin). */
  async accessibleProjectIds(user: User): Promise<string[] | null> {
    const wsIds = await this.access.accessibleWorkspaceIds(user);
    if (wsIds === null) return null;
    const projects = await this.prisma.project.findMany({
      where: { workspaceId: { in: wsIds } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  /** A Prisma where-fragment restricting `project_id` to accessible projects. */
  async scopeWhere(user: User): Promise<Record<string, unknown>> {
    const ids = await this.accessibleProjectIds(user);
    if (ids === null) return {};
    return { projectId: { in: ids } };
  }

  /** Assert the caller may write integrations for a project (member of its workspace). */
  async assertProjectWrite(user: User, projectId: string, permission: PermissionKey): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
    await this.access.assertPermission(user, project.workspaceId, permission);
  }

  /** Resolve a project's workspace, or throw 403 if the caller can't access it. */
  async workspaceOfProject(user: User, projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
    if (!(await this.access.can(user, project.workspaceId, Permission.ProjectRead))) {
      // membership floor still applies when RBAC is off
      await this.access.assertMember(user, project.workspaceId);
    }
    return project.workspaceId;
  }

  denied(): never {
    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
