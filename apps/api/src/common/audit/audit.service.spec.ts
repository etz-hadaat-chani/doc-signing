import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Db } from '../prisma/prisma.types.js';
import { AuditService } from './audit.service.js';

function fakeDb() {
  const create = vi.fn();
  return { create, db: { auditLog: { create } } as unknown as PrismaService & Db };
}

describe('AuditService', () => {
  it('has no way to change or remove rows: record is its only method', () => {
    expect(Object.getOwnPropertyNames(AuditService.prototype).sort()).toEqual([
      'constructor',
      'record',
    ]);
  });

  it('writes a user row with the user id', async () => {
    const { create, db } = fakeDb();
    await new AuditService(db).record({
      actor: { type: 'user', userId: 'u1' },
      action: 'auth.login',
      entity: { type: 'user', id: 'u1' },
      ip: '192.0.2.1',
      details: { userAgent: 'ua' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: 'user',
        userId: 'u1',
        action: 'auth.login',
        entityType: 'user',
        entityId: 'u1',
        ip: '192.0.2.1',
        details: { userAgent: 'ua' },
      },
    });
  });

  it('writes a system row without a user id, on the given transaction', async () => {
    const prisma = fakeDb();
    const tx = fakeDb();
    await new AuditService(prisma.db).record(
      {
        actor: { type: 'system' },
        action: 'auth.login_failed',
        entity: { type: 'user', id: null },
        ip: null,
        details: { email: 'a@b.c', reason: 'unknown_email' },
      },
      tx.db,
    );
    expect(prisma.create).not.toHaveBeenCalled();
    expect(tx.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorType: 'system', userId: null }) as object,
    });
  });

  it('refuses forbidden keys before writing anything', async () => {
    const { create, db } = fakeDb();
    const details = { email: 'a@b.c', reason: 'wrong_password', password: 'x' } as const;
    await expect(
      new AuditService(db).record({
        actor: { type: 'system' },
        action: 'auth.login_failed',
        entity: { type: 'user', id: null },
        ip: null,
        details,
      }),
    ).rejects.toThrow('"details.password"');
    expect(create).not.toHaveBeenCalled();
  });
});
