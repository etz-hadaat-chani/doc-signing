// Seed data for local development (`pnpm db:seed`, also run by `pnpm db:reset`).
// Safe to run repeatedly; refuses to run in production. Never prints the password.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { runSeed } from './run-seed.js';

// Same as main.ts: local dev reads the repo-root .env; elsewhere, real env vars.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The seed does not run in production (NODE_ENV=production).');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const created = await runSeed(prisma, { password: process.env.SEED_USER_PASSWORD });
    console.log(
      `Seed done. Created: ${created.users} users, ${created.departments} departments, ` +
        `${created.employees} employees, ${created.settings} settings.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
