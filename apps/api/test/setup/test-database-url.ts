import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * URL of the test database. TEST_DATABASE_URL if set; otherwise DATABASE_URL with the
 * database name swapped for `docsign_test`. Throws if the name doesn't end in `_test`,
 * so tests can never truncate the dev database.
 */
export function testDatabaseUrl(): string {
  // Same as main.ts: local dev reads the repo-root .env; existing env vars win.
  const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  let url: URL;
  if (process.env.TEST_DATABASE_URL) {
    url = new URL(process.env.TEST_DATABASE_URL);
  } else if (process.env.DATABASE_URL) {
    url = new URL(process.env.DATABASE_URL);
    url.pathname = '/docsign_test';
  } else {
    throw new Error('Set TEST_DATABASE_URL or DATABASE_URL (copy .env.example to .env).');
  }

  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Test database name must end in "_test", got "${url.pathname.slice(1)}".`);
  }
  return url.toString();
}
