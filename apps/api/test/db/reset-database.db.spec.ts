import { afterAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../setup/database.js';

const prisma: PrismaClient = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('resetDatabase', () => {
  it('empties audit_log despite its TRUNCATE trigger, and leaves the triggers on', async () => {
    await resetDatabase(prisma);
    const row = await prisma.auditLog.create({
      data: { actorType: 'system', action: 'test.reset', entityType: 'test' },
    });

    await resetDatabase(prisma);
    expect(await prisma.auditLog.count()).toBe(0);

    // RESTART IDENTITY: ids start again from 1.
    const next = await prisma.auditLog.create({
      data: { actorType: 'system', action: 'test.reset', entityType: 'test' },
    });
    expect(next.id).toBe(row.id);

    // SET LOCAL ended with the reset's transaction: run on every pooled connection to be sure.
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        await expect(
          prisma.auditLog.update({ where: { id: next.id }, data: { action: 'changed' } }),
        ).rejects.toThrow(/append-only: UPDATE/);
      }),
    );
    const roles = await prisma.$queryRaw<{ role: string }[]>`
      SELECT current_setting('session_replication_role') AS role`;
    expect(roles).toEqual([{ role: 'origin' }]);
  });

  it('checks the database name before running anything else', async () => {
    const statements: string[] = [];
    const tx = {
      $queryRaw: (query: TemplateStringsArray) => {
        statements.push(query.join('?'));
        return Promise.resolve([{ name: 'docsign' }]);
      },
      $executeRawUnsafe: (query: string) => {
        statements.push(query);
        return Promise.resolve(0);
      },
    };
    const fakePrisma = {
      $transaction: (fn: (client: typeof tx) => Promise<void>) => fn(tx),
    } as unknown as PrismaClient;

    await expect(resetDatabase(fakePrisma)).rejects.toThrow(
      'resetDatabase only runs on a *_test database, got "docsign".',
    );
    expect(statements).toEqual(['SELECT current_database() AS name']);
  });
});
