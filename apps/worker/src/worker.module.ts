import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@lt/config';
import { HeartbeatService } from './heartbeat.service';

/**
 * Worker root module — Phase 0. Infrastructure only (config + heartbeat).
 * BullMQ queues and processors are registered here in later phases (M§6.2);
 * none exist yet.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  providers: [HeartbeatService],
})
export class WorkerModule {}
