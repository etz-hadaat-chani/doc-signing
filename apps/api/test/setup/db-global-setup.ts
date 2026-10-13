import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { testBucketName } from './test-bucket.js';
import { testDatabaseUrl } from './test-database-url.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    s3Bucket: string;
  }
}

/** Creates the test database if it doesn't exist (connects to the server's `postgres` database). */
async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/postgres';

  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Runs once before the DB tests: create the test database and apply all migrations to it; pick
 * the test bucket (the storage adapter creates it).
 */
export default async function setup(project: TestProject): Promise<void> {
  const databaseUrl = testDatabaseUrl();
  await createDatabaseIfMissing(databaseUrl);

  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  project.provide('databaseUrl', databaseUrl);
  project.provide('s3Bucket', testBucketName());
}
