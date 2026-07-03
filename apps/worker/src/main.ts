import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '@lt/config';
import { WorkerModule } from './worker.module';

/**
 * The worker is a standalone application context — it NEVER serves HTTP
 * (arch §1, §12). It hosts BullMQ consumers (added in later phases).
 */
async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env as Record<string, unknown>);
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: false });
  app.enableShutdownHooks();
  Logger.log(
    `Worker ready — queue Redis db ${env.REDIS_QUEUE_DB}. Processors: email, git.`,
    'Worker',
  );
}

void bootstrap();
