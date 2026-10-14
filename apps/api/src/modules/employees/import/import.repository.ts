import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import type { Db } from '../../../common/prisma/prisma.types.js';
import type { EmployeeState } from '../employee-changes.js';
import type { CurrentData } from './import-diff.js';

const employeeStateSelect = {
  employeeNumber: true,
  idNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  emailStatus: true,
  phone: true,
  isActive: true,
  department: { select: { code: true } },
} as const;

/** Reads for the import (no writes here in 3.3). */
@Injectable()
export class ImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The stored employees and departments the file names: employees matched by employee number
   * (to compare) or by ID number (to find an ID that belongs to someone else), departments by code.
   */
  async currentData(
    keys: { employeeNumbers: string[]; idNumbers: string[]; departmentCodes: number[] },
    db: Db = this.prisma,
  ): Promise<CurrentData> {
    const [employees, departments] = await Promise.all([
      db.employee.findMany({
        where: {
          OR: [
            { employeeNumber: { in: keys.employeeNumbers } },
            { idNumber: { in: keys.idNumbers } },
          ],
        },
        select: employeeStateSelect,
      }),
      db.department.findMany({
        where: { code: { in: keys.departmentCodes } },
        select: { code: true, name: true },
      }),
    ]);
    const byNumber = new Map<string, EmployeeState>();
    const idOwners = new Map<string, string>();
    for (const { department, ...employee } of employees) {
      byNumber.set(employee.employeeNumber, { ...employee, departmentCode: department.code });
      idOwners.set(employee.idNumber, employee.employeeNumber);
    }
    return {
      employees: byNumber,
      idOwners,
      departments: new Map(departments.map(({ code, name }) => [code, name])),
    };
  }
}
