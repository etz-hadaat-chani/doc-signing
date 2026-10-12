import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Same as main.ts: local dev reads the repo-root .env; elsewhere, real env vars.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not env('DATABASE_URL'): it throws when unset, which breaks `prisma generate` in CI.
    // Commands that need the database (migrate, studio) still fail if it's missing.
    url: process.env.DATABASE_URL,
  },
});
