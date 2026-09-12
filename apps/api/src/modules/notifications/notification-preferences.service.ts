import { Injectable, Logger } from '@nestjs/common';
import { generateId, paginate } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { ReplaceNotificationPreferencesDto } from './dto';
import { notificationPreferenceResponse } from './mappers';

/** The channels a notification can be suppressed on. */
export type NotificationChannel = 'inApp' | 'email';

/** The two producers spell the same event differently — the browser templates
 *  use SCREAMING_SNAKE (`TASK_ASSIGNED`), the server's NotifiableEvent map uses
 *  snake_case (`leave_approved`) — so every read and write normalizes to one
 *  canonical form or a preference saved from Settings would never be found. */
export const normalizePreferenceType = (type: string): string => type.trim().toUpperCase();

/**
 * Per-user notification delivery preferences.
 *
 * Rows are PRIVATE to their owner: there is no cross-user read or write path,
 * because the caller of a notification producer is the ACTOR, not the recipient
 * — the recipient's choice must be enforced server-side or it cannot be
 * enforced at all.
 *
 * Storage is opt-out: a missing row means "deliver on every channel", so
 * existing users and workspaces keep today's behaviour with no backfill.
 */
@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger('NotificationPreferences');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** The caller's own preferences, optionally narrowed to one workspace. */
  async listMine(
    user: User,
    workspaceId?: string,
  ): Promise<PaginatedResponse<ReturnType<typeof notificationPreferenceResponse>>> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: user.id, ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { type: 'asc' },
    });
    const items = rows.map((r) => notificationPreferenceResponse(r));
    // Not a paged collection — the whole set is small and the screen needs all
    // of it — but it keeps the standard envelope every other list returns.
    return paginate(items, items.length, 1, items.length);
  }

  /** Upsert the caller's toggles for a workspace. `userId` is always the caller:
   *  a member must never be able to mute (or unmute) somebody else's feed. */
  async replaceMine(
    user: User,
    dto: ReplaceNotificationPreferencesDto,
  ): Promise<PaginatedResponse<ReturnType<typeof notificationPreferenceResponse>>> {
    await this.access.assertMember(user, dto.workspaceId);
    // De-duplicate first: two entries for the same type inside one payload would
    // otherwise race inside the transaction on the (workspace, user, type) unique.
    const byType = new Map<string, { inApp: boolean; email: boolean }>();
    for (const pref of dto.preferences) {
      byType.set(normalizePreferenceType(pref.type), { inApp: pref.inApp, email: pref.email });
    }
    await this.prisma.$transaction(
      [...byType].map(([type, channels]) =>
        this.prisma.notificationPreference.upsert({
          where: {
            workspaceId_userId_type: { workspaceId: dto.workspaceId, userId: user.id, type },
          },
          create: {
            id: generateId(),
            workspaceId: dto.workspaceId,
            userId: user.id,
            type,
            inApp: channels.inApp,
            email: channels.email,
          },
          update: { inApp: channels.inApp, email: channels.email },
        }),
      ),
    );
    return this.listMine(user, dto.workspaceId);
  }

  /**
   * The delivery gate every notification producer consults. Fails OPEN: a
   * preference lookup that errors must never silence a notification (or 500 the
   * request that triggered it), so an unreadable table behaves like "no
   * preference set".
   */
  async allows(
    workspaceId: string,
    userId: string,
    type: string,
    channel: NotificationChannel,
  ): Promise<boolean> {
    if (!workspaceId || !userId || !type) return true;
    try {
      const row = await this.prisma.notificationPreference.findUnique({
        where: {
          workspaceId_userId_type: {
            workspaceId,
            userId,
            type: normalizePreferenceType(type),
          },
        },
        select: { inApp: true, email: true },
      });
      if (!row) return true;
      return channel === 'email' ? row.email : row.inApp;
    } catch (err) {
      this.logger.warn(`preference lookup failed (${type}): ${(err as Error).message}`);
      return true;
    }
  }
}
