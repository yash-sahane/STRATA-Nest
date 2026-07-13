import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Worker liveness: connects to the BullMQ logical Redis DB and pings it on an
 * interval, logging reachability. The interval also keeps the standalone
 * process alive.
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
