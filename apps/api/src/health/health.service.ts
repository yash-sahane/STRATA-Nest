import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '@lt/prisma';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: boolean;
  redis: boolean;
  ts: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    return { status: db && redis ? 'ok' : 'degraded', db, redis, ts: new Date().toISOString() };
  }

  private async checkDb(): Promise<boolean> {
    try {
      return await this.prisma.ping();
    } catch (err) {
      this.logger.warn(`DB health check failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    const client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      db: this.config.get<number>('REDIS_CACHE_DB', 0),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await client.connect();
      return (await client.ping()) === 'PONG';
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return false;
    } finally {
      client.disconnect();
    }
  }
}
