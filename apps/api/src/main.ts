// Load .env FIRST so env-driven decorator config (rate limits) is available at
// module import time, before AppModule (and its @Throttle decorators) load.
import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from '@lt/common';
import { corsOrigins, validateEnv } from '@lt/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env as Record<string, unknown>);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger)); // structured pino logging + correlation ids

  // Frozen contract wiring (ADR-0003): global prefix /api/v1, cookie auth, envelopes.
  app.setGlobalPrefix(env.API_GLOBAL_PREFIX);
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({ origin: corsOrigins(env), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('L-T-Connect API')
    .setDescription('NestJS re-platform — v1 contract frozen (ADR-0003).')
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(env.API_PORT);
  app.get(Logger).log(`API listening on http://localhost:${env.API_PORT}/${env.API_GLOBAL_PREFIX}`);
}

void bootstrap();
