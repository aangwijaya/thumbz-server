// Must be imported before AppModule: ConfigModule validates env at import time.
const PLACEHOLDER_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://openapi:openapi@localhost:5432/openapi',
  SUPABASE_JWKS_URL:
    'https://openapi.supabase.co/auth/v1/.well-known/jwks.json',
  CORS_ORIGINS: 'http://localhost:3000',
  NODE_ENV: 'test',
};

for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) {
  process.env[key] ??= value;
}
