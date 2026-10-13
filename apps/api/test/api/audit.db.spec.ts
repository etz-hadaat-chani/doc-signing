import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import type { AuditDetailsMap } from '../../src/common/audit/audit.actions.js';
import { AuditService } from '../../src/common/audit/audit.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const manager = 'manager@doc-signing.local';

let app: INestApplication;
let prisma: PrismaService;
let audit: AuditService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  audit = app.get(AuditService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: 'test-seed-password' });
});

afterAll(async () => {
  await app.close();
});

async function managerUser() {
  return prisma.user.findUniqueOrThrow({ where: { email: manager } });
}

function logoutEntry(userId: string) {
  return {
    actor: { type: 'user', userId },
    action: 'auth.logout',
    entity: { type: 'user', id: userId },
    ip: '192.0.2.1',
    details: {},
  } as const;
}

describe('AuditService with the database', () => {
  it('writes a row', async () => {
    const user = await managerUser();
    await audit.record(logoutEntry(user.id));
    expect(await prisma.auditLog.findMany()).toEqual([
      expect.objectContaining({
        actorType: 'user',
        userId: user.id,
        action: 'auth.logout',
        entityType: 'user',
        entityId: user.id,
        ip: '192.0.2.1',
        details: {},
      }),
    ]);
  });

  it('rolls the log row back together with its change when the transaction fails', async () => {
    const user = await managerUser();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { fullName: 'שונה' } });
        await audit.record(logoutEntry(user.id), tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await prisma.auditLog.count()).toBe(0);
    expect((await managerUser()).fullName).toBe(user.fullName);
  });

  it('a forbidden key fails the log row and rolls back the change made before it', async () => {
    const user = await managerUser();
    const details = { email: manager, reason: 'wrong_password', password: 'x' } as const;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { fullName: 'שונה' } });
        const bad: AuditDetailsMap['auth.login_failed'] = details;
        await audit.record(
          {
            actor: { type: 'system' },
            action: 'auth.login_failed',
            entity: { type: 'user', id: user.id },
            ip: null,
            details: bad,
          },
          tx,
        );
      }),
    ).rejects.toThrow('"details.password"');

    expect(await prisma.auditLog.count()).toBe(0);
    expect((await managerUser()).fullName).toBe(user.fullName);
  });

  it('rows it writes cannot be updated or deleted (database triggers)', async () => {
    const user = await managerUser();
    await audit.record(logoutEntry(user.id));
    const row = await prisma.auditLog.findFirstOrThrow();

    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'changed' } }),
    ).rejects.toThrow(/append-only: UPDATE/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only: DELETE/,
    );
    expect(await prisma.auditLog.findFirstOrThrow()).toEqual(row);
  });
});
