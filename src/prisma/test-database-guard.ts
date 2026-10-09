const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/**
 * Fails closed: under test, a missing or non-local DATABASE_URL is an error
 * (set ALLOW_REMOTE_TEST_DB=1 to override deliberately).
 */
export function assertLocalTestDatabase(databaseUrl: string | undefined): void {
  if (process.env.ALLOW_REMOTE_TEST_DB === '1') {
    return;
  }
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set for tests. Expected .env.test (local Postgres).',
    );
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error('DATABASE_URL for tests is not a valid URL.');
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run tests against non-local database host "${host}". ` +
        'Point DATABASE_URL at the docker-compose Postgres, or set ALLOW_REMOTE_TEST_DB=1 if you really mean it.',
    );
  }
}
