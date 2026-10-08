import { configuration, DEFAULT_PORT, validateEnv } from './configuration';

const validEnv = {
  PORT: '3001',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_JWKS_URL:
    'https://example.supabase.co/auth/v1/.well-known/jwks.json',
  CORS_ORIGINS: 'http://localhost:3000',
};

function without(
  env: Record<string, string>,
  key: keyof typeof validEnv,
): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));
}

describe('validateEnv', () => {
  it('accepts a valid environment', () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
  });

  it('accepts an unset PORT', () => {
    expect(() => validateEnv(without(validEnv, 'PORT'))).not.toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv(without(validEnv, 'DATABASE_URL'))).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a non-postgres DATABASE_URL scheme', () => {
    expect(() =>
      validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-https SUPABASE_JWKS_URL', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        SUPABASE_JWKS_URL: 'http://example.supabase.co/jwks.json',
      }),
    ).toThrow(/SUPABASE_JWKS_URL/);
  });

  it('accepts an http JWKS URL only for a local Supabase stack', () => {
    const local = 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json';
    expect(() =>
      validateEnv({ ...validEnv, SUPABASE_JWKS_URL: local }),
    ).not.toThrow();
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        SUPABASE_JWKS_URL: local,
      }),
    ).toThrow(/SUPABASE_JWKS_URL/);
  });

  it('rejects an empty CORS_ORIGINS', () => {
    expect(() => validateEnv({ ...validEnv, CORS_ORIGINS: '' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('reports multiple violations at once', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*SUPABASE_JWKS_URL[\s\S]*CORS_ORIGINS/,
    );
  });
});

describe('configuration', () => {
  it('applies the default port when PORT is unset', () => {
    const config = configuration(without(validEnv, 'PORT'));
    expect(config.port).toBe(DEFAULT_PORT);
  });

  it('parses CORS_ORIGINS into a trimmed list', () => {
    const config = configuration({
      ...validEnv,
      CORS_ORIGINS: 'http://a.example,  http://b.example ,',
    });
    expect(config.corsOrigins).toEqual([
      'http://a.example',
      'http://b.example',
    ]);
  });

  it('exposes the remaining typed values', () => {
    const config = configuration(validEnv);
    expect(config).toEqual({
      nodeEnv: 'development',
      port: 3001,
      databaseUrl: validEnv.DATABASE_URL,
      supabaseJwksUrl: validEnv.SUPABASE_JWKS_URL,
      corsOrigins: ['http://localhost:3000'],
      frontendUrl: 'http://localhost:3000',
      publicApiUrl: 'http://localhost:3001',
      trustProxy: 0,
      logLevel: 'info',
      metricsToken: null,
      redisUrl: null,
      cacheNamespace: 'thumbz',
      liveSimulator: false,
      liveSimulatorIntervalMs: 5_000,
      revalidateSecret: null,
      xenditSecretKey: null,
      xenditCallbackToken: null,
      xenditApiBase: 'https://api.xendit.co',
      paymentsSandbox: false,
      ticketSigningSecret: 'dev-only-ticket-signing-secret-change-me',
      nowpaymentsApiKey: null,
      nowpaymentsIpnSecret: null,
      nowpaymentsApiBase: 'https://api-sandbox.nowpayments.io',
    });
  });

  it('treats blank optional values as unset', () => {
    const config = configuration({
      ...validEnv,
      NOWPAYMENTS_API_KEY: '  ',
      FRONTEND_URL: '',
      TRUST_PROXY: '',
    });
    expect(config.nowpaymentsApiKey).toBeNull();
    expect(config.frontendUrl).toBe('http://localhost:3000');
    expect(config.trustProxy).toBe(0);
  });

  it('strips trailing slashes from public URLs', () => {
    const config = configuration({
      ...validEnv,
      FRONTEND_URL: 'https://thumbz.example/',
      PUBLIC_API_URL: 'https://api.thumbz.example//',
    });
    expect(config.frontendUrl).toBe('https://thumbz.example');
    expect(config.publicApiUrl).toBe('https://api.thumbz.example');
  });
});

describe('validateEnv in production', () => {
  const production = { ...validEnv, NODE_ENV: 'production' };

  it('requires PUBLIC_API_URL, FRONTEND_URL, REDIS_URL and TICKET_SIGNING_SECRET', () => {
    expect(() => validateEnv(production)).toThrow(
      /PUBLIC_API_URL[\s\S]*FRONTEND_URL[\s\S]*REDIS_URL[\s\S]*TICKET_SIGNING_SECRET/,
    );
  });

  it('accepts a complete production environment', () => {
    expect(() =>
      validateEnv({
        ...production,
        PUBLIC_API_URL: 'https://api.thumbz.example',
        FRONTEND_URL: 'https://thumbz.example',
        REDIS_URL: 'redis://default:pw@redis.internal:6379',
        TICKET_SIGNING_SECRET: 'x'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('rejects a non-redis REDIS_URL', () => {
    expect(() =>
      validateEnv({ ...validEnv, REDIS_URL: 'http://localhost:6379' }),
    ).toThrow(/REDIS_URL/);
  });
});
