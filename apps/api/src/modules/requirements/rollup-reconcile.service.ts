import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  PrismaService,
  ROLLUP_RULES_VERSION,
  refreshClientRequirementRollup,
  refreshEpicRollup,
  refreshRequirementRollup,
} from '@strata/prisma';
import { REDIS_CLIENT } from '../../redis/redis.constants';

/**
 * Recompute every stored roll-up once whenever the rules change.
 *
 * The screens show the stored status and progress of requirements and epics,
 * and the status of client requirements, and those are refreshed when work
 * under them changes — so after a change of
 * rule, a requirement or epic nobody has touched since kept the figures of the
 * old one. Once per ROLLUP_RULES_VERSION (claimed in Redis, so one replica does
 * it), in the background: start-up does not wait for it.
 */
@Injectable()
export class RollupReconcileService implements OnApplicationBootstrap {
  private readonly logger = new Logger('RollupReconcile');

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || !this.redis) return;
    void this.run().catch((error: Error) => this.logger.warn(`roll-up reconcile stopped: ${error.message}`));
  }

  async run(): Promise<number> {
    const claimed = await this.redis?.set(`rollups:reconciled:${ROLLUP_RULES_VERSION}`, new Date().toISOString(), 'NX');
    if (this.redis && claimed !== 'OK') return 0;
    let moved = 0;
    // Requirements first: an epic counts a signed-off requirement as done.
    for (const { id } of await this.prisma.functionalRequirement.findMany({ select: { id: true } })) {
      if (await refreshRequirementRollup(this.prisma, id)) moved += 1;
    }
    for (const { id } of await this.prisma.epic.findMany({ select: { id: true } })) {
      if (await refreshEpicRollup(this.prisma, id)) moved += 1;
    }
    // Last: a client requirement reads its requirements' status.
    for (const { id } of await this.prisma.clientRequirement.findMany({ select: { id: true } })) {
      if (await refreshClientRequirementRollup(this.prisma, id)) moved += 1;
    }
    this.logger.log(`roll-ups recomputed under the ${ROLLUP_RULES_VERSION} rules: ${moved} changed`);
    return moved;
  }
}
