import { isValidIdNumber } from '@doc-signing/shared';
import { verify } from '@node-rs/argon2';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { runSeed } from '../../prisma/run-seed.js';
import { createTestPrisma, resetDatabase } from '../setup/database.js';

const prisma: PrismaClient = createTestPrisma();
const password = 'test-seed-password';

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Every seeded row, ordered, so two runs can be compared exactly. */
async function snapshot() {
  return {
    users: await prisma.user.findMany({ orderBy: { email: 'asc' } }),
    departments: await prisma.department.findMany({ orderBy: { code: 'asc' } }),
    employees: await prisma.employee.findMany({ orderBy: { employeeNumber: 'asc' } }),
    settings: await prisma.setting.findMany({ orderBy: { key: 'asc' } }),
  };
}

describe('seed', () => {
  it('creates the development data', async () => {
    const created = await runSeed(prisma, { password });
    expect(created).toEqual({ users: 2, departments: 3, employees: 20, settings: 4 });

    const { users, departments, employees, settings } = await snapshot();
    expect(users.map(({ role }) => role).sort()).toEqual(['manager', 'officer']);
    expect(departments.map(({ code }) => code)).toEqual([15, 19, 61]);
    expect(departments.every(({ name }) => /[֐-׿]/.test(name))).toBe(true);
    expect(Object.fromEntries(settings.map(({ key, value }) => [key, value]))).toEqual({
      reminder_interval_days: 3,
      max_reminders: null,
      link_expiry_days: 60,
      sender_name: 'מערכת חתימות',
    });

    for (const employee of employees) {
      expect(employee.idNumber).toMatch(/^\d{9}$/);
      expect(isValidIdNumber(employee.idNumber), employee.idNumber).toBe(true);
    }
    expect(employees.some(({ idNumber }) => idNumber.startsWith('0'))).toBe(true);
    const noEmail = employees.filter(({ emailStatus }) => emailStatus === 'missing');
    expect(noEmail).toHaveLength(2);
    expect(noEmail.every(({ email }) => email === null)).toBe(true);
    const names = employees.map(({ firstName, lastName }) => `${firstName} ${lastName}`);
    expect(names).toContain('שרה כהן-לוי 2');
    expect(names.some((name) => /\d/.test(name) && /-/.test(name))).toBe(true);
  });

  it('hashes passwords with Argon2 and stores lowercase emails', async () => {
    await runSeed(prisma, { password });
    const users = await prisma.user.findMany();
    for (const user of users) {
      expect(user.email).toBe(user.email.toLowerCase());
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verify(user.passwordHash, password)).toBe(true);
    }
  });

  it('changes nothing on a second run', async () => {
    await runSeed(prisma, { password });
    const first = await snapshot();

    const created = await runSeed(prisma, { password });
    expect(created).toEqual({ users: 0, departments: 0, employees: 0, settings: 0 });
    const second = await snapshot();
    expect(Object.values(second).map((rows) => rows.length)).toEqual([2, 3, 20, 4]);
    expect(second).toEqual(first);
  });

  it('keeps a setting a manager changed', async () => {
    await runSeed(prisma, { password });
    await prisma.setting.update({ where: { key: 'link_expiry_days' }, data: { value: 30 } });

    await runSeed(prisma, { password });
    const setting = await prisma.setting.findUniqueOrThrow({ where: { key: 'link_expiry_days' } });
    expect(setting.value).toBe(30);
  });

  it('refuses to run in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(runSeed(prisma, { password })).rejects.toThrow('does not run in production');
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses to run without a password', async () => {
    await expect(runSeed(prisma, { password: undefined })).rejects.toThrow('SEED_USER_PASSWORD');
    expect(await prisma.user.count()).toBe(0);
  });
});
