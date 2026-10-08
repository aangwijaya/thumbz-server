/**
 * Jest setup for unit and e2e runs. Loads .env.test and refuses to run
 * against anything but a local/CI database: the e2e suites write and delete
 * rows, and the developer .env may point at the shared cloud project.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

const envFile = resolve(__dirname, '../.env.test');
if (existsSync(envFile)) {
  // Does not override variables already set (CI service containers win).
  process.loadEnvFile(envFile);
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
  const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run tests against non-local database host "${host}". ` +
        'Point DATABASE_URL at the docker-compose Postgres, or set ALLOW_REMOTE_TEST_DB=1 if you really mean it.',
    );
  }
}
