/**
 * Jest setup for unit and e2e runs. Loads .env.test and refuses to run
 * against anything but a local/CI database: the suites write and delete rows,
 * and the developer .env may point at the shared cloud project.
 *
 * Two traps this guards against:
 * - process.loadEnvFile() writes the real process environment, not the jest
 *   sandbox's process.env, so values are assigned here explicitly;
 * - requiring @prisma/client loads .env when DATABASE_URL is unset, so the
 *   URL must be set before any import of Prisma and checked fail-closed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { assertLocalTestDatabase } from '../src/prisma/test-database-guard';

const envFile = resolve(__dirname, '../.env.test');
if (existsSync(envFile)) {
  const values = parseEnv(readFileSync(envFile, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    // Variables already set (CI service containers) win.
    process.env[key] ??= value;
  }
}

assertLocalTestDatabase(process.env.DATABASE_URL);

// Each test file gets its own cache namespace: suites run in parallel and
// back to back against one Redis, and must never read each other's entries.
process.env.CACHE_NAMESPACE ??= `test:${randomUUID()}`;
