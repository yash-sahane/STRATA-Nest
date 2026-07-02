import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import type { PermissionKey } from './permissions';
import { REQUIRE_PERMISSION } from './require-permission.decorator';
import { WorkspaceAccessService } from './workspace-access.service';

/**
 * Enforces `@RequirePermission(...)` when the target workspace id is resolvable
 * from the request (body/query/params.workspaceId). For resource-detail routes
 * where the workspace is on the resource, the owning service enforces it after
 * a scoped fetch (so out-of-scope resources 404 as in Django).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: WorkspaceAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<PermissionKey>(REQUIRE_PERMISSION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!permission) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    if (!req.user) throw new ForbiddenException();

    const body = (req.body ?? {}) as { workspaceId?: string };
    const query = (req.query ?? {}) as { workspaceId?: string };
    const params = (req.params ?? {}) as { workspaceId?: string };
    const workspaceId = body.workspaceId || query.workspaceId || params.workspaceId;
    if (!workspaceId) return true; // service-level enforcement applies

    await this.access.assertPermission(req.user, workspaceId, permission);
    return true;
  }
}
