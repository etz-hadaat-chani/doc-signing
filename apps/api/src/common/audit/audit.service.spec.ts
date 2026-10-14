import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Db } from '../prisma/prisma.types.js';
import { AuditService } from './audit.service.js';

function fakeDb() {
  const create = vi.fn();
  const createMany = vi.fn();
  return {
    create,
    createMany,
    db: { auditLog: { create, createMany } } as unknown as PrismaService & Db,
  };
}

describe('AuditService', () => {
  it('has no way to change or remove rows: it only adds', () => {
    expect(Object.getOwnPropertyNames(AuditService.prototype).sort()).toEqual([
      'constructor',
      'record',
      'recordMany',
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

  it('writes many rows in one insert, on the given transaction', async () => {
    const prisma = fakeDb();
    const tx = fakeDb();
    await new AuditService(prisma.db).recordMany(
      ['e1', 'e2'].map((id) => ({
        actor: { type: 'user', userId: 'u1' } as const,
        action: 'employee.updated' as const,
        entity: { type: 'employee', id } as const,
        ip: null,
        details: { changes: ['firstName: א → ב'], importBatchId: 'b1' },
      })),
      tx.db,
    );
    expect(prisma.createMany).not.toHaveBeenCalled();
    expect(tx.createMany).toHaveBeenCalledTimes(1);
    expect(tx.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ entityId: 'e1', action: 'employee.updated' }),
        expect.objectContaining({ entityId: 'e2', action: 'employee.updated' }),
      ] as object[],
    });
  });

  it('recordMany with no entries writes nothing', async () => {
    const { createMany, db } = fakeDb();
    await new AuditService(db).recordMany([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('recordMany refuses the whole call when one entry has a forbidden key', async () => {
    const { createMany, db } = fakeDb();
    const safe = {
      actor: { type: 'system' } as const,
      action: 'auth.login_failed' as const,
      entity: { type: 'user', id: null } as const,
      ip: null,
      details: { email: 'a@b.c', reason: 'wrong_password' } as const,
    };
    const unsafe = { ...safe, details: { ...safe.details, idNumber: '1' } };
    await expect(new AuditService(db).recordMany([safe, unsafe])).rejects.toThrow(
      '"details.idNumber"',
    );
    expect(createMany).not.toHaveBeenCalled();
  });
});
