import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from '@lt/config';
import { PrismaModule } from '@lt/prisma';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { AuthzModule } from './modules/authz/authz.module';
import { PermissionsGuard } from './modules/authz/permissions.guard';
import { EpicsModule } from './modules/epics/epics.module';
import { MailModule } from './modules/mail/mail.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RequirementsModule } from './modules/requirements/requirements.module';
import { SprintsModule } from './modules/sprints/sprints.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { RedisModule } from './redis/redis.module';
import { AuthThrottlerGuard } from './throttling/auth-throttler.guard';
import { THROTTLE } from './throttling/throttle.constants';

/**
 * Root module. Phase-1 domain (Auth, Users) + infrastructure: validated config,
 * structured logging w/ correlation ids (pino), rate limiting (throttler),
 * Prisma, Redis, mail stub, health. Guards run rate-limit → auth.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          // Correlation id: honor inbound X-Request-Id, else generate; echo on the response.
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          // Never log secrets/cookies/passwords.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
            ],
            remove: true,
          },
          transport:
            config.get<string>('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: THROTTLE.default.ttl, limit: THROTTLE.default.limit },
    ]),
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
    MailModule,
    AuthzModule,
    HealthModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    ProjectsModule,
    RequirementsModule,
    EpicsModule,
    SprintsModule,
    TasksModule,
    RealtimeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthThrottlerGuard }, // 1. rate-limit (even unauthenticated)
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // 2. authenticate
    { provide: APP_GUARD, useClass: PermissionsGuard }, // 3. @RequirePermission (when workspaceId in request)
  ],
})
export class AppModule {}
