import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@lt/config';
import { EmailProcessor } from './email/email.processor';
import { HeartbeatService } from './heartbeat.service';

/**
 * Worker root module. Infrastructure (config + heartbeat) + BullMQ processors.
 * Phase 10 adds the email processor (`email` queue); more queues (git, exports)
 * register here in later phases (M§6.2).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  providers: [HeartbeatService, EmailProcessor],
})
export class WorkerModule {}
