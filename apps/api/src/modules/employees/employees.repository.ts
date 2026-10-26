import {
  EMPLOYEE_EXTRA_FIELDS,
  type EmailStatus,
  type EmployeeExtras,
  type EmployeeListQuery,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { searchCondition } from './employee-search.js';

/** The phones and extra details (FR-EMP-1, FR-EMP-9): card, edit and import. Never the list. */
export const employeeDetailsSelect = {
  landline: true,
  mobile: true,
  address: true,
  city: true,
  birthDate: true,
  jobTitle: true,
  employmentStatus: true,
  jobPercent: true,
  workDays: true,
  hoursBaseCode: true,
  pensionFundA: true,
  pensionFundB: true,
  studyFund: true,
} satisfies Prisma.EmployeeSelect;
type EmployeeDetailsRow = Prisma.EmployeeGetPayload<{ select: typeof employeeDetailsSelect }>;

/** The phones and extras as plain values: the birth date as `YYYY-MM-DD`, numbers as numbers. */
export type EmployeeDetails = EmployeeExtras & { landline: string | null; mobile: string | null };

/**
 * A `date` column comes back as midnight UTC of that day; its UTC parts are the day, whatever
 * the server's time zone.
 */
function dayOf(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → the Date Prisma writes to a `date` column as that same day (midnight UTC). */
export function dayToDate(day: string | null): Date | null {
  return day === null ? null : new Date(`${day}T00:00:00.000Z`);
}

/** A stored row's phones and extras as plain values (only these fields, whatever the row has). */
export function detailsFromRow(row: EmployeeDetailsRow): EmployeeDetails {
  return {
    landline: row.landline,
    mobile: row.mobile,
    address: row.address,
    city: row.city,
    birthDate: dayOf(row.birthDate),
    jobTitle: row.jobTitle,
    employmentStatus: row.employmentStatus,
    jobPercent: row.jobPercent === null ? null : row.jobPercent.toNumber(),
    workDays: row.workDays,
    hoursBaseCode: row.hoursBaseCode,
    pensionFundA: row.pensionFundA,
    pensionFundB: row.pensionFundB,
    studyFund: row.studyFund,
  };
}

/** The phones and extras, in the order of the card. */
export const DETAIL_FIELDS = [
  'landline',
  'mobile',
  ...EMPLOYEE_EXTRA_FIELDS,
] as const satisfies readonly (keyof EmployeeDetails)[];

/** Only the details that were sent (not `undefined`); `null` is kept (it clears the field). */
export function sentDetails(input: Partial<EmployeeDetails>): Partial<EmployeeDetails> {
  return Object.fromEntries(
    DETAIL_FIELDS.flatMap((field) => (input[field] === undefined ? [] : [[field, input[field]]])),
  );
}

/** No phone and no extra details. */
export const NO_DETAILS: EmployeeDetails = Object.freeze({
  landline: null,
  mobile: null,
  address: null,
  city: null,
  birthDate: null,
  jobTitle: null,
  employmentStatus: null,
  jobPercent: null,
  workDays: null,
  hoursBaseCode: null,
  pensionFundA: null,
  pensionFundB: null,
  studyFund: null,
});

/** Plain phones and extras → the values Prisma writes. */
export function detailsToData(details: EmployeeDetails) {
  return {
    landline: details.landline,
    mobile: details.mobile,
    address: details.address,
    city: details.city,
    birthDate: dayToDate(details.birthDate),
    jobTitle: details.jobTitle,
    employmentStatus: details.employmentStatus,
    jobPercent: details.jobPercent,
    workDays: details.workDays,
    hoursBaseCode: details.hoursBaseCode,
    pensionFundA: details.pensionFundA,
    pensionFundB: details.pensionFundB,
    studyFund: details.studyFund,
  } satisfies Prisma.EmployeeUncheckedUpdateInput;
}

/** The employee fields the card returns, with the department. */
export const employeeCardSelect = {
  id: true,
  employeeNumber: true,
  idNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  emailStatus: true,
  ...employeeDetailsSelect,
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

function whereClause({ q, dept, emailStatus, active }: EmployeeListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (dept !== undefined) conditions.push(Prisma.sql`e.department_id = ${dept}::uuid`);
  if (emailStatus !== undefined) {
    conditions.push(Prisma.sql`e.email_status = ${emailStatus}::email_status`);
  }
  if (active !== undefined) conditions.push(Prisma.sql`e.is_active = ${active}`);
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
