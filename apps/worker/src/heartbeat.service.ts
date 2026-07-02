import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Phase 0 worker liveness: connects to the BullMQ logical Redis DB (ADR-0007)
 * and heartbeats. There are NO domain processors yet — queues + processors
 * (email, notification, git, …) are added in later phases (M§6.2). The interval
 * keeps the standalone process alive until real BullMQ Workers exist.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Heartbeat');
  private timer?: NodeJS.Timeout;
  private redis?: Redis;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      db: this.config.get<number>('REDIS_QUEUE_DB', 1),
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    try {
      await this.redis.connect();
    } catch (err) {
      this.logger.warn(`Queue Redis not reachable yet: ${(err as Error).message}`);
    }
    this.timer = setInterval(() => void this.beat(), 30_000);
    await this.beat();
  }

  private async beat(): Promise<void> {
    try {
      const pong = await this.redis?.ping();
      this.logger.debug(`alive (redis ${pong ?? 'n/a'})`);
    } catch (err) {
      this.logger.warn(`heartbeat: redis unreachable (${(err as Error).message})`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.redis?.disconnect();
  }
}
