import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { WorkspaceAccessService } from './workspace-access.service';

/** Global RBAC/scope layer used by every domain module. */
@Global()
@Module({
  providers: [WorkspaceAccessService, PermissionsGuard],
  exports: [WorkspaceAccessService, PermissionsGuard],
})
export class AuthzModule {}
