import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RealtimeSubscriber } from './realtime.subscriber';
import { SocketRegistry } from './socket-registry';

/**
 * Realtime layer. Imports AuthModule for TokenService (cookie auth).
 * RealtimeService registers the Prisma write hook on init (central CRUD events).
 */
@Module({
  imports: [AuthModule],
  providers: [
    RealtimeGateway,
    RealtimeService,
    RealtimeAuthService,
    RealtimeSubscriber,
    SocketRegistry,
  ],
  exports: [RealtimeService], // used by DeletionModule for explicit delete-frame emission
})
export class RealtimeModule {}
