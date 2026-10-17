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
 * Key of the session-level advisory lock one DB test run holds from start to end (the app's own
 * locks use 3_xxx_xxx keys).
 */
const TEST_RUN_LOCK = 9_000_001;
/** How long a second run waits for the first before giving up. */
const TEST_RUN_WAIT = '10min';

/**
 * Only one DB test run at a time: two runs (two terminals, or an editor's test runner) share the
 * test database, so each one's resetDatabase would empty tables under the other's tests (lost
 * sessions, missing rows, deadlocks on TRUNCATE). The lock is held on its own connection until
 * the run ends; if the run is killed, Postgres drops the connection and the lock with it.
 * Returns the function that releases it.
 */
async function lockTestRun(databaseUrl: string): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  const tried = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
    TEST_RUN_LOCK,
  ]);
  if (!tried.rows[0]?.locked) {
    console.log('Another DB test run is using the test database; waiting for it to finish...');
    try {
      await client.query(`SET lock_timeout = '${TEST_RUN_WAIT}'`);
      await client.query('SELECT pg_advisory_lock($1)', [TEST_RUN_LOCK]);
    } catch (error) {
      await client.end();
      throw new Error(
        `Another DB test run held the test database for over ${TEST_RUN_WAIT}. Stop it and run again.`,
        { cause: error },
      );
    }
  }
  return async () => {
    await client.end();
  };
}

/**
 * Runs once before the DB tests: create the test database, wait for any other DB test run to end
 * (lockTestRun), apply all migrations; pick the test bucket (the storage adapter creates it).
 * Returns the teardown that releases the run lock.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const databaseUrl = testDatabaseUrl();
  await createDatabaseIfMissing(databaseUrl);
  const unlock = await lockTestRun(databaseUrl);

  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  project.provide('databaseUrl', databaseUrl);
  project.provide('s3Bucket', testBucketName());
  return unlock;
}
