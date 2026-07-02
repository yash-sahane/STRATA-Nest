import { z } from 'zod';

/**
 * Single source of truth for environment configuration, validated at boot.
 * Mirrors the Django settings surface (CURRENT_SYSTEM_AUDIT.md §3) and the new
 * async/realtime/security knobs (TARGET_ARCHITECTURE_NESTJS.md, ADR-0007/0009).
 *
 * Validation is fail-fast: a missing/invalid var aborts startup with a clear
 * message instead of failing deep inside a request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // API
  API_PORT: z.coerce.number().int().positive().default(8000),
  API_GLOBAL_PREFIX: z.string().default('api/v1'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Worker
  WORKER_PORT: z.coerce.number().int().positive().default(8001),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis (partitioned by logical DB — ADR-0007)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_CACHE_DB: z.coerce.number().int().min(0).default(0),
  REDIS_QUEUE_DB: z.coerce.number().int().min(0).default(1),
  REDIS_SOCKET_DB: z.coerce.number().int().min(0).default(2),

  // Auth / JWT (cookie-based — ADR-0009)
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800),
  JWT_ACCESS_COOKIE_NAME: z.string().default('lt_access'),
  JWT_REFRESH_COOKIE_NAME: z.string().default('lt_refresh'),
  JWT_COOKIE_DOMAIN: z.string().optional(),
  JWT_COOKIE_SECURE: z.coerce.boolean().default(false),
  JWT_COOKIE_SAMESITE: z.enum(['Lax', 'Strict', 'None']).default('Lax'),
  // Refresh-token migration (PHASE_1_AUTH_PLAN §7): false = compatibility mode
  // (accept signature-valid Django tokens); true = strict (jti must be in Redis).
  AUTH_STRICT_REFRESH: z.coerce.boolean().default(false),

  // Email (Resend; queued — ADR-0007)
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('noreply@example.com'),

  // Storage (StorageService — arch §13)
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./.storage'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_STORAGE_BUCKET_NAME: z.string().optional(),
  AWS_S3_REGION_NAME: z.string().default('us-east-1'),
  AWS_S3_ENDPOINT_URL: z.string().optional(),

  // Integration token encryption (closes D4)
  INTEGRATION_TOKEN_ENC_KEY: z.string().optional(),

  // Observability
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Rate limiting (AUTH_SECURITY_CHECKLIST) — TTLs in seconds, limits in requests/TTL.
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(120),
  THROTTLE_DEFAULT_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LOGIN_LIMIT: z.coerce.number().int().positive().default(5),
  THROTTLE_LOGIN_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_REFRESH_LIMIT: z.coerce.number().int().positive().default(20),
  THROTTLE_REFRESH_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_REGISTER_LIMIT: z.coerce.number().int().positive().default(3),
  THROTTLE_REGISTER_TTL: z.coerce.number().int().positive().default(3600),
  THROTTLE_RESET_LIMIT: z.coerce.number().int().positive().default(3),
  THROTTLE_RESET_TTL: z.coerce.number().int().positive().default(3600),

  // Characterization / contract tests (ADR-0003, arch §19)
  DJANGO_API_URL: z.string().default('http://localhost:8000'),
});

export type Env = z.infer<typeof envSchema>;

/** Validate a raw env object (e.g. process.env). Throws on the first failure set. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
