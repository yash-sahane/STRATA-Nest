import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// NOTE: `@prisma/client` types/values exist only after `pnpm prisma:generate`.
// In a fresh checkout run `pnpm prisma:pull && pnpm prisma:generate` first.
import { PrismaClient } from '@prisma/client';

/**
 * Thin Nest wrapper over PrismaClient — the single DB access point (arch §4).
 * Connection lifecycle is tied to the Nest module lifecycle so the health
 * check and graceful shutdown work in both api and worker processes.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight liveness probe used by the health endpoint. */
  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
