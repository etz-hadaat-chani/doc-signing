import {
  type EmailStatus,
  type EmployeeListQuery,
  normalizeEmployeeNumber,
  normalizeIdNumber,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';

/** The employee fields the card returns, with the department. */
export const employeeCardSelect = {
  id: true,
  employeeNumber: true,
  idNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  emailStatus: true,
  phone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, code: true, name: true } },
} satisfies Prisma.EmployeeSelect;
export type EmployeeCardRow = Prisma.EmployeeGetPayload<{ select: typeof employeeCardSelect }>;

/** One list row as the search query returns it (no ID number). */
export interface EmployeeListRow {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  emailStatus: EmailStatus;
  isActive: boolean;
  departmentId: string;
  departmentCode: number;
  departmentName: string;
}

/** `%`, `_` and `\` in the search are plain characters, not LIKE wildcards. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function contains(text: string): string {
  return `%${escapeLike(text)}%`;
}

/**
 * The search (q arrives trimmed, with runs of spaces made one): part of the first name, last name,
 * "first last" or "last first"; part of the employee number (leading zeros ignored); or, when q is
 * 1–9 digits, exactly the ID number with its leading zeros put back. The ID is never matched
 * partially, so digits can't be used to fish for IDs.
 */
function searchCondition(q: string): Prisma.Sql {
  const pattern = contains(q);
  const parts = [
    Prisma.sql`(e.first_name || ' ' || e.last_name) ILIKE ${pattern} ESCAPE '\\'`,
    Prisma.sql`(e.last_name || ' ' || e.first_name) ILIKE ${pattern} ESCAPE '\\'`,
    Prisma.sql`e.employee_number LIKE ${contains(normalizeEmployeeNumber(q) ?? q)} ESCAPE '\\'`,
  ];
  const idNumber = normalizeIdNumber(q);
  if (idNumber !== null) parts.push(Prisma.sql`e.id_number = ${idNumber}`);
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

function whereClause({ q, dept, emailStatus }: EmployeeListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (dept !== undefined) conditions.push(Prisma.sql`e.department_id = ${dept}::uuid`);
  if (emailStatus !== undefined) {
    conditions.push(Prisma.sql`e.email_status = ${emailStatus}::email_status`);
  }
  if (q !== undefined) conditions.push(searchCondition(q));
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/** Employee queries that search, count, join or lock (layering rule). */
@Injectable()
export class EmployeesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page by last name, first name, then id (stable), and the total; filters combine (AND). */
  async list(query: EmployeeListQuery): Promise<{ rows: EmployeeListRow[]; total: number }> {
    const where = whereClause(query);
    const [rows, [count]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<EmployeeListRow[]>`
        SELECT e.id, e.employee_number AS "employeeNumber", e.first_name AS "firstName",
               e.last_name AS "lastName", e.email, e.email_status::text AS "emailStatus",
               e.is_active AS "isActive", d.id AS "departmentId", d.code AS "departmentCode",
               d.name AS "departmentName"
        FROM employees e
        JOIN departments d ON d.id = e.department_id
        ${where}
        ORDER BY e.last_name, e.first_name, e.id
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM employees e ${where}`,
    ]);
    return { rows, total: Number(count?.total ?? 0) };
  }

  /** Locks one employee's row (FOR UPDATE) and reads it; null when there is no such employee. */
  async lockEmployee(id: string, db: Db): Promise<EmployeeCardRow | null> {
    await db.$queryRaw`SELECT id FROM employees WHERE id = ${id}::uuid FOR UPDATE`;
    return db.employee.findUnique({ where: { id }, select: employeeCardSelect });
  }
}
