import { inject } from 'vitest';

// Runs in every DB test file: point code that reads DATABASE_URL and S3_BUCKET at the test
// database and the test bucket.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.S3_BUCKET = inject('s3Bucket');
