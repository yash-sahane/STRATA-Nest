// Load .env FIRST so env-driven decorator config (rate limits) is available at
// module import time, before AppModule (and its @Throttle decorators) load.
// Path is resolved relative to this file, not process.cwd() — so this finds
// the repo-root .env whether started from the repo root, from apps/api
// directly, or as the compiled dist/main.js (same directory depth either way).
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
loadEnv({ path: join(__dirname, '../../../.env') });
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from '@strata/common';
import { corsOrigins, validateEnv } from '@strata/config';
import { AppModule } from './app.module';
import { NormalizedWsAdapter } from './modules/realtime/normalized-ws-adapter';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env as Record<string, unknown>);
  // rawBody: capture the exact request bytes so inbound webhooks can verify
  // provider HMAC signatures over the raw payload.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger)); // structured pino logging + correlation ids
  // Raw WebSocket gateway at /ws/collections/. NormalizedWsAdapter normalizes a
  // trailing-slash path mismatch in the stock WsAdapter (the client URL has a
  // trailing slash); see its docstring.
  app.useWebSocketAdapter(new NormalizedWsAdapter(app));

  // Wire the public v1 contract: global prefix /api/v1, cookie auth, envelopes.
  app.setGlobalPrefix(env.API_GLOBAL_PREFIX);
  app.use(cookieParser());
  // Production helmet: HSTS + no cross-origin resource embedding. In dev we relax
  // COEP/HSTS so local tooling + Swagger UI work.
  const isProd = env.NODE_ENV === 'production';
  app.use(
    helmet(
      isProd
        ? { hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } }
        : { hsts: false, contentSecurityPolicy: false },
    ),
  );
  app.enableCors({ origin: corsOrigins(env), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // Swagger is off in production unless SWAGGER_ENABLED=true — the API schema is
  // not exposed publicly by default.
  if (!isProd || env.SWAGGER_ENABLED) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('STRATA API')
      .setDescription('STRATA REST API — v1.')
      .setVersion('1.0.0')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(env.API_PORT);
  app.get(Logger).log(`API listening on http://localhost:${env.API_PORT}/${env.API_GLOBAL_PREFIX}`);
}

void bootstrap();
