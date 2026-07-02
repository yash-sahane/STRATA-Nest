import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permissions';

export const REQUIRE_PERMISSION = 'requirePermission';

/** Declarative permission requirement (checked by PermissionsGuard when the
 *  target workspace id is present in the request body/query/params). Services
 *  remain the authoritative enforcement point for resource-scoped mutations. */
export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(REQUIRE_PERMISSION, permission);
