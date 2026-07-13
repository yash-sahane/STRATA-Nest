import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { validateEnv } from '@strata/config';
import { PrismaModule } from '@strata/prisma';
import { EmailProcessor } from './email/email.processor';
import { GitProcessor } from './git/git.processor';
import { HeartbeatService } from './heartbeat.service';

/**
 * Worker root module. Infrastructure (config + Prisma + heartbeat) + BullMQ
 * processors. Email queue + git queue (webhook commits → DB + task auto-status).
 */
@Module({
  imports: [
    // envFilePath is resolved relative to this file (not process.cwd()) so the
    // repo-root .env loads regardless of how/where the worker process is started.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: join(__dirname, '../../../.env'),
    }),
    PrismaModule,
  ],
  providers: [HeartbeatService, EmailProcessor, GitProcessor],
})
export class WorkerModule {}
