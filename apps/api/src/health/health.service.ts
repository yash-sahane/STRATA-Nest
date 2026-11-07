import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisConnection } from '@strata/config';
import Redis from 'ioredis';
import { PrismaService } from '@strata/prisma';

/** Well inside the 5s the image HEALTHCHECK and most pollers allow. */
const PROBE_DEADLINE_MS = 2000;

/** The probe's answer, or `false` once `ms` have passed without one. */
function withDeadline(probe: Promise<boolean>, ms: number, onTimeout: () => void): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(false);
    }, ms);
  });
  return Promise.race([probe, deadline]).finally(() => clearTimeout(timer));
}

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
    // Each probe has a hard deadline. The client timeouts below are not enough on
    // their own: a port proxy (Docker Desktop's, a cloud LB) can accept the TCP
    // connection for a dependency that is gone and then stall the handshake,
    // which no connect timeout sees — measured at 5s with Redis stopped, the
    // whole of the image HEALTHCHECK's budget.
    const [db, redis] = await Promise.all([
      withDeadline(this.checkDb(), PROBE_DEADLINE_MS, () => this.logger.warn('DB health check timed out')),
      withDeadline(this.checkRedis(), PROBE_DEADLINE_MS, () => this.logger.warn('Redis health check timed out')),
    ]);
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
    // One quick attempt, no reconnect loop: a health probe has to answer within
    // the poller's timeout (the image HEALTHCHECK allows 5s), and the defaults
    // (10s connect timeout, retry forever) let it hang past that when Redis was
    // unreachable rather than report it.
    const client = new Redis({
      ...redisConnection((key) => this.config.get(key), 'cache'),
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 1500,
      commandTimeout: 1500,
      retryStrategy: () => null,
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
