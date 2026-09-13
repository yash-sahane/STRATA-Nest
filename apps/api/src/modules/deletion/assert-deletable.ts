import { NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PermissionKey } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';

/**
 * Authorise an aggregate delete without telling a stranger what exists.
 *
 * Every one of the seven deletion services was written as
 *
 *     const row = await prisma.x.findUnique(...)
 *     if (!row) throw new NotFoundException('Not found.')
 *     await access.assertPermission(user, row.workspaceId, SomePermission)
 *
 * which answers 403 when the row exists and 404 when it does not. For somebody
 * with no membership of the workspace at all, that difference IS the answer to
 * "does this id exist?", and it can be walked. Measured on epics: an outsider got
 * DELETE 403 for a real id and DELETE 404 for an invented one, while GET
 * correctly answered 404 for both.
 *
 * The distinction that matters is between a stranger and a member:
 *
 *   not a member      -> 404. The resource does not exist as far as they are
 *                        concerned, which is what every read path already says.
 *   member, no rights -> 403. They can see the thing; being told they may not
 *                        delete it reveals nothing they did not already know, and
 *                        a 404 here would be a lie that sends them looking for a
 *                        record that is on their screen.
 */
export async function assertDeletable(
  access: WorkspaceAccessService,
  user: User,
  workspaceId: string,
  permission: PermissionKey,
): Promise<void> {
  if (access.isPlatformAdmin(user)) return;
  try {
    await access.assertMember(user, workspaceId);
  } catch {
    // Deliberately NOT rethrowing whatever assertMember threw: a 403 "not a
    // member" would leak exactly what this exists to hide.
    throw new NotFoundException('Not found.');
  }
  await access.assertPermission(user, workspaceId, permission);
}
