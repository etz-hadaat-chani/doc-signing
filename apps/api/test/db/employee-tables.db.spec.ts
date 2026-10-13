import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../setup/database.js';

const prisma: PrismaClient = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createDepartment(name = 'מחלקת בדיקות') {
  return prisma.department.create({ data: { name } });
}

function employeeData(departmentId: string, employeeNumber: string, idNumber: string) {
  return {
    employeeNumber,
    idNumber,
    firstName: 'ישראל',
    lastName: 'ישראלי',
    departmentId,
    emailStatus: 'missing' as const,
  };
}

describe('employees', () => {
  it('rejects a duplicate employee_number', async () => {
    const department = await createDepartment();
    await prisma.employee.create({ data: employeeData(department.id, '1001', '000000018') });

    await expect(
      prisma.employee.create({ data: employeeData(department.id, '1001', '000000026') }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate id_number', async () => {
    const department = await createDepartment();
    await prisma.employee.create({ data: employeeData(department.id, '1001', '000000018') });

    await expect(
      prisma.employee.create({ data: employeeData(department.id, '1002', '000000018') }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('departments', () => {
  it("can't be deleted while it has employees", async () => {
    const department = await createDepartment();
    await prisma.employee.create({ data: employeeData(department.id, '1001', '000000018') });

    await expect(prisma.department.delete({ where: { id: department.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.department.count()).resolves.toBe(1);
  });
});
