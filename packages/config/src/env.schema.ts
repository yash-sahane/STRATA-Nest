import { z } from 'zod';

/**
 * Robust boolean env parser. `z.coerce.boolean()` uses `Boolean(str)`, so the
 * string "false" (and "0", "no") coerce to TRUE — a dangerous footgun for flags
 * like RBAC_ENFORCED / JWT_COOKIE_SECURE. This maps common truthy/falsey strings
 * explicitly and falls back to `def` when unset.
 */
const boolEnv = (def: boolean) =>
  z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null) return def;
    const s = String(v).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off', ''].includes(s)) return false;
    return v; // anything else → let z.boolean() reject it
  }, z.boolean());

/**
 * Single source of truth for environment configuration, validated at boot.
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

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis (partitioned by logical DB)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_CACHE_DB: z.coerce.number().int().min(0).default(0),
  REDIS_QUEUE_DB: z.coerce.number().int().min(0).default(1),

  // Auth / JWT (cookie-based)
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800),
  JWT_ACCESS_COOKIE_NAME: z.string().default('strata_access'),
  JWT_REFRESH_COOKIE_NAME: z.string().default('strata_refresh'),
  JWT_COOKIE_DOMAIN: z.string().optional(),
  JWT_COOKIE_SECURE: boolEnv(false),
  JWT_COOKIE_SAMESITE: z.enum(['Lax', 'Strict', 'None']).default('Lax'),
  // Failed sign-ins are counted per ACCOUNT as well as per address: after this
  // many inside the window the account takes no more guesses, from anywhere,
  // until the window has run out. 0 switches the pause off.
  AUTH_LOCKOUT_ATTEMPTS: z.coerce.number().int().min(0).default(10),
  AUTH_LOCKOUT_WINDOW: z.coerce.number().int().positive().default(900),
  // RBAC_ENFORCED: false = membership-only floor; true = enforce
  // per-permission role checks on writes. Secure by default — set to false
  // only as an explicit, temporary rollback lever (docs/release/ROLLBACK.md).
  RBAC_ENFORCED: boolEnv(true),

  // Email (Resend; queued). EMAIL_TRANSPORT: 'queue' enqueues to BullMQ (the
  // worker sends); 'inline' logs synchronously (fallback when the worker is
  // unavailable).
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('noreply@example.com'),
  EMAIL_TRANSPORT: z.enum(['queue', 'inline']).default('queue'),

  // Storage (StorageService)
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./.storage'),

  // Integration token encryption
  INTEGRATION_TOKEN_ENC_KEY: z.string().optional(),

  // Observability
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  // Swagger/OpenAPI UI. Off unless explicitly enabled; forced off in production
  // unless SWAGGER_ENABLED=true — the schema is not exposed publicly by default.
  SWAGGER_ENABLED: boolEnv(false),

  // Rate limiting — TTLs in seconds, limits in requests/TTL.
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(120),
  THROTTLE_DEFAULT_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LOGIN_LIMIT: z.coerce.number().int().positive().default(5),
  THROTTLE_LOGIN_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_REFRESH_LIMIT: z.coerce.number().int().positive().default(20),
  THROTTLE_REFRESH_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_RESET_LIMIT: z.coerce.number().int().positive().default(3),
  THROTTLE_RESET_TTL: z.coerce.number().int().positive().default(3600),
  // Proxies whose X-Real-IP / X-Forwarded-For are believed when keying rate
  // limits and sign-in lockouts: comma-separated addresses, CIDR ranges,
  // `loopback`, or host names. Empty = nobody. Parsed and checked entry by entry
  // in apps/api/src/throttling/trusted-proxies.ts (a bad entry stops the boot).
  TRUSTED_PROXIES: z.string().default('loopback'),
})
  /**
   * Production-only hard gates. In `production` we refuse to boot with
   * unsafe defaults instead of degrading silently: weak/short signing keys, a
   * missing token-encryption key, or non-Secure auth cookies. Non-prod keeps the
   * relaxed defaults for local/dev/test ergonomics.
   */
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const requireLen = (field: keyof typeof env, min: number, why: string) => {
      const val = (env[field] as string | undefined) ?? '';
      if (val.length < min) {
        ctx.addIssue({
          code: 'custom',
          path: [field as string],
          message: `${String(field)} must be ≥ ${min} chars in production (${why}).`,
        });
      }
    };
    requireLen('JWT_ACCESS_SECRET', 32, 'weak signing key');
    requireLen('JWT_REFRESH_SECRET', 32, 'weak signing key');
    requireLen('INTEGRATION_TOKEN_ENC_KEY', 32, 'token encryption at rest');
    if (!env.JWT_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_COOKIE_SECURE'],
        message: 'JWT_COOKIE_SECURE must be true in production (auth cookies over HTTPS only).',
      });
    }
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
