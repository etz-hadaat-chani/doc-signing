import { inject } from 'vitest';

// Runs in every DB test file: point code that reads DATABASE_URL and S3_BUCKET at the test
// database and the test bucket.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.S3_BUCKET = inject('s3Bucket');
// Mailpit has no limit; the send tests shouldn't wait on the production default.
process.env.EMAIL_SEND_RATE_PER_SECOND = '100';
