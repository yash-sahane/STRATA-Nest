import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { IntegrationAccess } from '../integrations/integration-access.service';
import { DeletionSideEffectsService } from './deletion-side-effects.service';

type Provider = 'github' | 'gitlab' | 'discord';
const MAP: Record<Provider, { model: string; label: string }> = {
  github: { model: 'gitHubIntegration', label: 'GITHUB' },
  gitlab: { model: 'gitLabIntegration', label: 'GITLAB' },
  discord: { model: 'discordIntegration', label: 'DISCORD' },
};

/**
 * IntegrationDeletionService. Before removing a provider integration: revoke the
 * webhook (best-effort — see DeletionSideEffectsService.revokeWebhooks
 * limitation), delete the encrypted credential + row. The single-row `delete`
 * fires the realtime write-hook frame.
 */
@Injectable()
export class IntegrationDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IntegrationAccess,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async delete(user: User, provider: Provider, id: string): Promise<void> {
    const { model, label } = MAP[provider];
    const delegate = (this.prisma as unknown as Record<string, { findUnique(a: unknown): Promise<{ id: string; projectId: string } | null>; delete(a: unknown): Promise<unknown> }>)[model];
    const row = await delegate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Not found.');
    await this.ia.assertProjectWrite(user, row.projectId, Permission.IntegrationWrite);

    // Zone 2a — revoke BEFORE deleting the row (needs the projectId).
    this.sideEffects.revokeWebhooks([{ provider: label, projectId: row.projectId }]);
    // Delete the encrypted credential + row (fires realtime .delete via write-hook).
    await delegate.delete({ where: { id } });
  }
}
