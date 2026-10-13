import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../setup/database.js';

const prisma: PrismaClient = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser() {
  return prisma.user.create({
    data: {
      fullName: 'מנהלת בדיקות',
      email: 'manager@example.com',
      passwordHash: 'not-a-real-hash',
      role: 'manager',
    },
  });
}

async function createLogRow() {
  return prisma.auditLog.create({
    data: { actorType: 'system', action: 'round.send', entityType: 'round' },
  });
}

describe('audit_log', () => {
  it('inserts a row with details defaulting to {}', async () => {
    const user = await createUser();
    const row = await prisma.auditLog.create({
      data: {
        userId: user.id,
        actorType: 'user',
        action: 'document.view',
        entityType: 'assignment',
        entityId: '00000000-0000-4000-8000-000000000001',
        ip: '192.0.2.1',
      },
    });
    expect(typeof row.id).toBe('bigint');
    expect(row.details).toEqual({});
    expect(row).not.toHaveProperty('updatedAt');
  });

  it('rejects UPDATE', async () => {
    const row = await createLogRow();
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'changed' } }),
    ).rejects.toThrow(/append-only: UPDATE/);
  });

  it('rejects DELETE', async () => {
    const row = await createLogRow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only: DELETE/,
    );
  });

  it('rejects TRUNCATE, also when cascaded from users', async () => {
    await createLogRow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_log"')).rejects.toThrow(
      /append-only: TRUNCATE/,
    );
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE')).rejects.toThrow(
      /append-only: TRUNCATE/,
    );
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it.each(['employee', 'system'] as const)('accepts actor %s without a user', async (actorType) => {
    await prisma.auditLog.create({ data: { actorType, action: 'a', entityType: 'e' } });
  });

  it('rejects actor user without a user_id', async () => {
    await expect(
      prisma.auditLog.create({ data: { actorType: 'user', action: 'a', entityType: 'e' } }),
    ).rejects.toThrow('audit_log_actor_user_check');
  });

  it.each(['employee', 'system'] as const)('rejects actor %s with a user_id', async (actorType) => {
    const user = await createUser();
    await expect(
      prisma.auditLog.create({
        data: { userId: user.id, actorType, action: 'a', entityType: 'e' },
      }),
    ).rejects.toThrow('audit_log_actor_user_check');
  });
});

describe('settings', () => {
  it('stores JSON values, including null, with timestamps', async () => {
    await prisma.setting.create({ data: { key: 'max_reminders', value: Prisma.JsonNull } });
    await prisma.setting.create({ data: { key: 'sender_name', value: 'מערכת חתימות' } });
    const maxReminders = await prisma.setting.findUniqueOrThrow({
      where: { key: 'max_reminders' },
    });
    expect(maxReminders.value).toBeNull();
    expect(maxReminders.createdAt).toBeInstanceOf(Date);
    expect(maxReminders.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate key', async () => {
    await prisma.setting.create({ data: { key: 'link_expiry_days', value: 60 } });
    await expect(
      prisma.setting.create({ data: { key: 'link_expiry_days', value: 30 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('indexes (PRD section 12)', () => {
  it.each([
    ['assignments', 'round_id, status'],
    ['assignments', 'round_id, department_id'],
    ['assignments', 'employee_id'],
    ['assignments', 'status, last_reminder_at'],
    ['email_messages', 'provider_message_id'],
    ['email_messages', 'assignment_id'],
    ['audit_log', 'entity_type, entity_id'],
    ['audit_log', 'created_at'],
    ['employees', 'department_id'],
  ])('%s(%s) exists', async (table, columns) => {
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${table}`;
    const wanted = `USING btree (${columns})`;
    expect(indexes.map(({ indexdef }) => indexdef.endsWith(wanted))).toContain(true);
  });
});
