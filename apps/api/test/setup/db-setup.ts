import { inject } from 'vitest';

// Runs in every DB test file: point code that reads DATABASE_URL at the test database.
process.env.DATABASE_URL = inject('databaseUrl');
