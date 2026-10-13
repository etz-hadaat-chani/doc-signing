import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Storage bucket for tests. TEST_S3_BUCKET if set; otherwise S3_BUCKET + `-test`. Throws if
 * the name doesn't end in `-test`, so tests never write to the dev bucket. The storage
 * adapter creates it at startup when missing.
 */
export function testBucketName(): string {
  // Same as test-database-url.ts: local dev reads the repo-root .env; existing env vars win.
  const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const bucket =
    process.env.TEST_S3_BUCKET || (process.env.S3_BUCKET ? `${process.env.S3_BUCKET}-test` : '');
  if (!bucket) {
    throw new Error('Set TEST_S3_BUCKET or S3_BUCKET (copy .env.example to .env).');
  }
  if (!bucket.endsWith('-test')) {
    throw new Error(`Test bucket name must end in "-test", got "${bucket}".`);
  }
  return bucket;
}
