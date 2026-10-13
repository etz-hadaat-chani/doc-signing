import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/** A Prisma client for the test database (DATABASE_URL is set by db-setup.ts). */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

/**
 * Empties every table except Prisma's migration history. Call in beforeEach.
 *
 * audit_log has triggers that reject TRUNCATE, so this runs with session_replication_role =
 * replica, which skips ordinary triggers (needs a superuser). SET LOCAL ends with the
 * transaction, so the pooled connection never keeps the triggers off. Test database only;
 * the name check runs before anything else.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    const name = row?.name ?? '';
    if (!name.endsWith('_test')) {
      throw new Error(`resetDatabase only runs on a *_test database, got "${name}".`);
    }

    const tables = await tx.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length === 0) return;
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');

    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  });
}
