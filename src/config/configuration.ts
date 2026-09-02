export interface AppConfig {
  port: number;
  databaseUrl: string;
  supabaseJwksUrl: string;
  corsOrigins: string[];
}

export const DEFAULT_PORT = 3001;

function parsePort(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  const databaseUrl = config.DATABASE_URL;
  if (
    typeof databaseUrl !== 'string' ||
    !/^postgres(ql)?:\/\//.test(databaseUrl)
  ) {
    errors.push(
      'DATABASE_URL is required and must start with postgresql:// or postgres://',
    );
  }

  const supabaseJwksUrl = config.SUPABASE_JWKS_URL;
  if (
    typeof supabaseJwksUrl !== 'string' ||
    !/^https:\/\//.test(supabaseJwksUrl)
  ) {
    errors.push('SUPABASE_JWKS_URL is required and must be an https:// URL');
  }

  const corsOrigins = config.CORS_ORIGINS;
  if (typeof corsOrigins !== 'string' || corsOrigins.trim() === '') {
    errors.push(
      'CORS_ORIGINS is required and must be a comma-separated list of origins',
    );
  }

  try {
    parsePort(config.PORT);
  } catch (error) {
    errors.push((error as Error).message);
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  return config;
}

export function configuration(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    databaseUrl: env.DATABASE_URL as string,
    supabaseJwksUrl: env.SUPABASE_JWKS_URL as string,
    corsOrigins: (env.CORS_ORIGINS as string)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
}
