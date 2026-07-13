import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { RefreshTokenStore } from '../auth/services/refresh-token.store';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectDelete, type TxLike } from './deletion.util';

/**
 * UserDeactivationService — the ONLY user "delete": users are SOFT-DELETED,
 * never physically removed. Deactivates + revokes access + tokens; **preserves**
 * all HR/audit/authored records (accountability). There is deliberately no
 * hard-delete endpoint.
 */
@Injectable()
export class UserDeactivationService {
  private readonly logger = new Logger('UserDeactivation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly tokens: RefreshTokenStore,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async deactivate(actor: User, userId: string): Promise<{ deactivated: true }> {
    // Platform admins, or the user themselves, may deactivate.
    if (!this.access.isPlatformAdmin(actor) && actor.id !== userId) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Not found.');

    const deleted: DeletedEntity[] = [];
    // Capture memberships (for realtime member-removed frames) before deletion.
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { id: true, workspaceId: true },
    });

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      // Soft delete: deactivate the account.
      await (txc as unknown as { user: { update(a: unknown): Promise<unknown> } }).user.update({
        where: { id: userId },
        data: { isActive: false, status: 'INACTIVE' },
      });
      // Revoke access + ephemeral state.
      await collectDelete(tx, 'activeTimer', 'active_timers', { userId }, deleted);
      await collectDelete(tx, 'notification', 'notifications', { userId }, deleted);
      await collectDelete(tx, 'workspaceMember', 'workspace_members', { userId }, deleted);
      await collectDelete(tx, 'joinRequest', 'join_requests', { userId }, deleted);
      await collectDelete(tx, 'pendingWorkspaceAccess', 'pending_workspace_access', { userId }, deleted);
      // PRESERVE: attendance, leave, leaveBalance, timeEntry, activityLog, taskComment.
    });

    // Zone 2: revoke sessions + emit member-removed frames per workspace.
    await this.tokens.revokeAll(userId).catch(() => undefined);
    for (const m of memberships) {
      this.sideEffects.emitDeletes([{ collection: 'workspace_members', id: m.id, workspaceId: m.workspaceId }]);
    }
    this.sideEffects.emitDeletes(deleted.filter((d) => d.collection !== 'workspace_members'));
    this.logger.log(`user ${userId} deactivated; access + tokens revoked; records preserved`);
    return { deactivated: true };
  }
}
