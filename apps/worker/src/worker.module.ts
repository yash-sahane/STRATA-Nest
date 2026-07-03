import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@lt/config';
import { PrismaModule } from '@lt/prisma';
import { EmailProcessor } from './email/email.processor';
import { GitProcessor } from './git/git.processor';
import { HeartbeatService } from './heartbeat.service';

/**
 * Worker root module. Infrastructure (config + Prisma + heartbeat) + BullMQ
 * processors. Phase 10: email queue; Phase 11: git queue (webhook commits →
 * DB + task auto-status). More queues register here later (M§6.2).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule],
  providers: [HeartbeatService, EmailProcessor, GitProcessor],
})
export class WorkerModule {}
