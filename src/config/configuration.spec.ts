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
      port: 3001,
      databaseUrl: validEnv.DATABASE_URL,
      supabaseJwksUrl: validEnv.SUPABASE_JWKS_URL,
      corsOrigins: ['http://localhost:3000'],
    });
  });
});
