import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { lockAdministration } from '../authz/administration';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { RefreshTokenStore } from '../auth/services/refresh-token.store';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectDelete, type TxLike } from './deletion.util';

/**
 * UserDeactivationService — the ONLY user "delete": users are SOFT-DELETED,
 * never physically removed. Deactivates + revokes access + tokens; **preserves**
 * all HR/audit/authored records (accountability). There is deliberately no
 * hard-delete endpoint. `PATCH /users/:id {status: INACTIVE}` comes through here.
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
    const switchedOff: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      const memberships = await txc.workspaceMember.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { id: true, workspaceId: true },
      });
      // Each of those workspaces' administration held still until this commits,
      // as a demotion or a removal holds it: a manager demoted in one of them at
      // the same moment would otherwise pass its own check — this account still
      // counted — while this check counted that manager.
      await lockAdministration(
        txc,
        memberships.map((m) => m.workspaceId),
      );
      // The rules every other way out of a workspace keeps, asked in the same
      // transaction as the writes they guard.
      await this.assertOwnsNothing(txc, target);
      await this.assertNotLastManager(txc, target, memberships);
      // Soft delete: deactivate the account.
      await txc.user.update({
        where: { id: userId },
        data: { isActive: false, status: 'INACTIVE' },
      });
      // Every membership switched OFF, not deleted. Left ACTIVE (the status
      // flag on the account was all that changed), a disabled account went on
      // counting as an approver and as a manager for the last-manager rule,
      // sat in every assignee picker and kept being sent notices. Deleted, it
      // took with it the record of who held what — so switching the account
      // back on, which deliberately does NOT re-open them, leaves each workspace
      // to switch its member back on at the role they had.
      if (memberships.length) {
        await txc.workspaceMember.updateMany({
          where: { id: { in: memberships.map((m) => m.id) } },
          data: { status: 'INACTIVE' },
        });
        for (const m of memberships) {
          switchedOff.push({ collection: 'workspace_members', id: m.id, workspaceId: m.workspaceId });
        }
      }
      // Revoke ephemeral state.
      await collectDelete(tx, 'activeTimer', 'active_timers', { userId }, deleted);
      await collectDelete(tx, 'notification', 'notifications', { userId }, deleted);
      await collectDelete(tx, 'joinRequest', 'join_requests', { userId }, deleted);
      // PRESERVE: attendance, leave, leaveBalance, timeEntry, activityLog, taskComment.
    });

    // Zone 2: revoke sessions + frames for every row the bulk writes changed
    // (updateMany/deleteMany are invisible to the write hook).
    await this.tokens.revokeAll(userId).catch(() => undefined);
    this.sideEffects.emitUpdates(switchedOff);
    this.sideEffects.emitDeletes(deleted);
    this.logger.log(`user ${userId} deactivated; memberships switched off; tokens revoked; records preserved`);
    return { deactivated: true };
  }

  /**
   * A workspace's owner cannot be removed, switched off or leave — by identity,
   * and with no platform-admin exemption, as `leave` holds it — so their account
   * is not switched off from under the workspace either. Ownership is handed
   * over first; a platform administrator can do that for them.
   */
  private async assertOwnsNothing(txc: Prisma.TransactionClient, target: User): Promise<void> {
    const owned = await txc.workspace.findMany({
      where: { ownerId: target.id },
      select: { name: true },
    });
    if (owned.length === 0) return;
    const names = owned.map((w) => `"${w.name}"`).join(', ');
    throw new ForbiddenException(
      `${target.name || target.email} owns ${names}. Hand ${owned.length === 1 ? 'it' : 'them'} to somebody else first (Settings > Workspace > Transfer ownership), then switch the account off.`,
    );
  }

  /** Nor is a workspace left with nobody active able to manage it — the same
   *  invariant a removal or a role change answers to. */
  private async assertNotLastManager(
    txc: Prisma.TransactionClient,
    target: User,
    memberships: Array<{ id: string; workspaceId: string }>,
  ): Promise<void> {
    const stranded: string[] = [];
    for (const m of memberships) {
      const orphaned = await this.access.capabilitiesOrphanedBy(
        m.workspaceId,
        { membershipId: m.id, role: null },
        txc,
      );
      if (orphaned.length) stranded.push(m.workspaceId);
    }
    if (stranded.length === 0) return;
    const workspaces = await txc.workspace.findMany({
      where: { id: { in: stranded } },
      select: { name: true },
    });
    const names = workspaces.map((w) => `"${w.name}"`).join(', ');
    throw new ForbiddenException(
      `${target.name || target.email} is the last manager of ${names}. Make somebody else a manager there first, then switch the account off.`,
    );
  }
}
