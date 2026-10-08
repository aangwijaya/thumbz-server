import { z } from 'zod';

export const DEFAULT_PORT = 3001;

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  supabaseJwksUrl: string;
  corsOrigins: string[];
  /** Browser-facing client URL (payment return pages, links in notifications). */
  frontendUrl: string;
  /** Public base URL of this API (payment provider callbacks). */
  publicApiUrl: string;
  /** Number of reverse-proxy hops to trust for client IPs (Railway = 1). */
  trustProxy: number;
  logLevel: string;
  /** When set, GET /metrics requires `Authorization: Bearer <token>`. */
  metricsToken: string | null;
  redisUrl: string | null;
  /** Prefix for cache keys in Redis (default "thumbz"). */
  cacheNamespace: string;
  /** Demo mode: seeded live matches keep "playing" (see LiveSimulatorService). */
  liveSimulator: boolean;
  liveSimulatorIntervalMs: number;
  /** Shared secret for POST {frontendUrl}/api/revalidate; null disables it. */
  revalidateSecret: string | null;
  nowpaymentsApiKey: string | null;
  nowpaymentsIpnSecret: string | null;
  nowpaymentsApiBase: string;
}

/** Env vars are often present but empty (`FOO=`); treat that as unset. */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional());
}

const httpUrl = z
  .string()
  .trim()
  .regex(/^https?:\/\/[^\s]+$/, 'must be an http(s):// URL')
  .transform((url) => url.replace(/\/+$/, ''));

const envSchema = z
  .object({
    NODE_ENV: optional(z.enum(['development', 'test', 'production'])),
    PORT: z.preprocess(
      blankToUndefined,
      z.coerce
        .number('PORT must be an integer between 1 and 65535')
        .int('PORT must be an integer between 1 and 65535')
        .min(1, 'PORT must be an integer between 1 and 65535')
        .max(65535, 'PORT must be an integer between 1 and 65535')
        .optional(),
    ),
    DATABASE_URL: z
      .string(
        'DATABASE_URL is required and must start with postgresql:// or postgres://',
      )
      .regex(
        /^postgres(ql)?:\/\//,
        'DATABASE_URL is required and must start with postgresql:// or postgres://',
      ),
    SUPABASE_JWKS_URL: z
      .string('SUPABASE_JWKS_URL is required and must be an https:// URL')
      .regex(
        /^https:\/\//,
        'SUPABASE_JWKS_URL is required and must be an https:// URL',
      ),
    CORS_ORIGINS: z
      .string(
        'CORS_ORIGINS is required and must be a comma-separated list of origins',
      )
      .trim()
      .min(
        1,
        'CORS_ORIGINS is required and must be a comma-separated list of origins',
      ),
    FRONTEND_URL: optional(httpUrl),
    PUBLIC_API_URL: optional(httpUrl),
    TRUST_PROXY: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(0).max(10).optional(),
    ),
    LOG_LEVEL: optional(
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    ),
    METRICS_TOKEN: optional(
      z.string().min(16, 'METRICS_TOKEN must be at least 16 characters'),
    ),
    REDIS_URL: optional(
      z.string().regex(/^rediss?:\/\//, 'REDIS_URL must be a redis:// URL'),
    ),
    CACHE_NAMESPACE: optional(
      z
        .string()
        .regex(/^[a-z0-9:_-]{1,60}$/i, 'CACHE_NAMESPACE must be [a-z0-9:_-]'),
    ),
    LIVE_SIMULATOR: optional(z.enum(['true', 'false', '1', '0'])),
    LIVE_SIMULATOR_INTERVAL_MS: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1_000).max(60_000).optional(),
    ),
    REVALIDATE_SECRET: optional(
      z.string().min(16, 'REVALIDATE_SECRET must be at least 16 characters'),
    ),
    NOWPAYMENTS_API_KEY: optional(z.string().trim()),
    NOWPAYMENTS_IPN_SECRET: optional(z.string().trim()),
    NOWPAYMENTS_API_BASE: optional(httpUrl),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }
    // Without these, payment callbacks and return URLs would silently point
    // at localhost, and rate limits/caches would be per-instance.
    for (const key of [
      'PUBLIC_API_URL',
      'FRONTEND_URL',
      'REDIS_URL',
    ] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when NODE_ENV=production`,
        });
      }
    }
  });

type ParsedEnv = z.infer<typeof envSchema>;

function parseEnv(env: Record<string, unknown>): ParsedEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  parseEnv(config);
  return config;
}

export function configuration(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = parseEnv(env);
  const port = parsed.PORT ?? DEFAULT_PORT;
  const corsOrigins = parsed.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    nodeEnv: parsed.NODE_ENV ?? 'development',
    port,
    databaseUrl: parsed.DATABASE_URL,
    supabaseJwksUrl: parsed.SUPABASE_JWKS_URL,
    corsOrigins,
    frontendUrl:
      parsed.FRONTEND_URL ?? corsOrigins[0] ?? 'http://localhost:3000',
    publicApiUrl: parsed.PUBLIC_API_URL ?? `http://localhost:${port}`,
    trustProxy: parsed.TRUST_PROXY ?? 0,
    logLevel: parsed.LOG_LEVEL ?? 'info',
    metricsToken: parsed.METRICS_TOKEN ?? null,
    redisUrl: parsed.REDIS_URL ?? null,
    cacheNamespace: parsed.CACHE_NAMESPACE ?? 'thumbz',
    liveSimulator: ['true', '1'].includes(parsed.LIVE_SIMULATOR ?? ''),
    liveSimulatorIntervalMs: parsed.LIVE_SIMULATOR_INTERVAL_MS ?? 5_000,
    revalidateSecret: parsed.REVALIDATE_SECRET ?? null,
    nowpaymentsApiKey: parsed.NOWPAYMENTS_API_KEY || null,
    nowpaymentsIpnSecret: parsed.NOWPAYMENTS_IPN_SECRET || null,
    nowpaymentsApiBase:
      parsed.NOWPAYMENTS_API_BASE ?? 'https://api-sandbox.nowpayments.io',
  };
}
