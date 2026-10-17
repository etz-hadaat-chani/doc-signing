import { IMPORT_PREVIEW_MAX_AGE_HOURS, type ImportStatus } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import type { Db } from '../../../common/prisma/prisma.types.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { EmployeeState } from '../employee-changes.js';
import { detailsFromRow, detailsToData, employeeDetailsSelect } from '../employees.repository.js';
import type { CurrentData, ImportDiff } from './import-diff.js';

const employeeStateSelect = {
  employeeNumber: true,
  idNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  emailStatus: true,
  ...employeeDetailsSelect,
  isActive: true,
  department: { select: { code: true } },
} as const;

/**
 * Key of the transaction-level advisory lock taken by every import confirm, so two confirms
 * never run at the same time. Any fixed number works; this one is used for nothing else.
 */
const IMPORT_COMMIT_LOCK = 3_004_001;

/** The keys a file names: employees by number or ID number, departments by code. */
export interface ImportKeys {
  employeeNumbers: string[];
  idNumbers: string[];
  departmentCodes: number[];
}

/** A batch as the confirm reads it. `expired` is computed by the database clock. */
export interface BatchRow {
  id: string;
  fileName: string;
  fileKey: string;
  status: ImportStatus;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsFailed: number;
  errors: unknown;
  expired: boolean;
}

/** An employee to write, with its department already resolved to an id. */
export type EmployeeWrite = EmployeeState & { departmentId: string };

/** Reads and writes for the Excel import (3.3 preview, 3.4 confirm). */
@Injectable()
export class ImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The stored employees and departments the file names: employees matched by employee number
   * (to compare) or by ID number (to find an ID that belongs to someone else), departments by code.
   */
  async currentData(keys: ImportKeys, db: Db = this.prisma): Promise<CurrentData> {
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
      const state = { ...employee, ...detailsFromRow(employee), departmentCode: department.code };
      byNumber.set(employee.employeeNumber, state);
      idOwners.set(employee.idNumber, employee.employeeNumber);
    }
    return {
      employees: byNumber,
      idOwners,
      departments: new Map(departments.map(({ code, name }) => [code, name])),
    };
  }

  /**
   * Preview: share-locks the rows the file names before reading them. An edit already in
   * progress finishes first (so the preview sees it), and a later edit waits until the preview
   * is saved (so its updated_at is after the batch's created_at). Never blocks other reads.
   */
  async shareLockKeys(keys: ImportKeys, db: Db): Promise<void> {
    await db.$queryRaw`
      SELECT 1 FROM employees
      WHERE employee_number = ANY(${keys.employeeNumbers}::text[])
         OR id_number = ANY(${keys.idNumbers}::text[])
      ORDER BY id FOR SHARE`;
    await db.$queryRaw`
      SELECT 1 FROM departments WHERE code = ANY(${keys.departmentCodes}::int[])
      ORDER BY id FOR SHARE`;
  }

  /** Confirm: one at a time. Held until the transaction ends. */
  async lockCommits(db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${IMPORT_COMMIT_LOCK}::bigint)`;
  }

  /**
   * The batch, or null. `expired` = made more than IMPORT_PREVIEW_MAX_AGE_HOURS ago, by the
   * database clock. `lock` takes the row lock (FOR UPDATE) inside the confirm's transaction.
   */
  async findBatch(id: string, { lock }: { lock: boolean }, db: Db = this.prisma) {
    const rows = await db.$queryRaw<BatchRow[]>`
      SELECT id, file_name AS "fileName", file_key AS "fileKey", status::text AS status,
             rows_total AS "rowsTotal", rows_created AS "rowsCreated",
             rows_updated AS "rowsUpdated", rows_unchanged AS "rowsUnchanged",
             rows_failed AS "rowsFailed", errors,
             created_at < now() - make_interval(hours => ${IMPORT_PREVIEW_MAX_AGE_HOURS}::int)
               AS expired
      FROM import_batches WHERE id = ${id}::uuid
      ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return rows[0] ?? null;
  }

  /**
   * Confirm: locks (FOR UPDATE) every stored row the file names (employees by number or ID
   * number, departments by code) and tells whether any of them was created or changed after
   * the batch was made (the narrow stale check). Rows not in the file are neither locked nor
   * looked at.
   */
  async lockKeysAndCheckStale(batchId: string, keys: ImportKeys, db: Db): Promise<boolean> {
    const employees = await db.$queryRaw<{ changed: boolean }[]>`
      SELECT (e.created_at > b.created_at OR e.updated_at > b.created_at) AS changed
      FROM employees e, import_batches b
      WHERE b.id = ${batchId}::uuid
        AND (e.employee_number = ANY(${keys.employeeNumbers}::text[])
             OR e.id_number = ANY(${keys.idNumbers}::text[]))
      ORDER BY e.id FOR UPDATE OF e`;
    const departments = await db.$queryRaw<{ changed: boolean }[]>`
      SELECT (d.created_at > b.created_at OR d.updated_at > b.created_at) AS changed
      FROM departments d, import_batches b
      WHERE b.id = ${batchId}::uuid AND d.code = ANY(${keys.departmentCodes}::int[])
      ORDER BY d.id FOR UPDATE OF d`;
    return [...employees, ...departments].some((row) => row.changed);
  }

  /**
   * Creates the new departments and renames the known ones, by code only. Returns code → id for
   * every code in `codes`.
   */
  async saveDepartments(
    {
      newDepartments,
      renamedDepartments,
    }: Pick<ImportDiff, 'newDepartments' | 'renamedDepartments'>,
    codes: number[],
    db: Db,
  ): Promise<Map<number, string>> {
    if (newDepartments.length > 0) {
      await db.department.createMany({
        data: newDepartments.map(({ code, name }) => ({ code, name })),
      });
    }
    if (renamedDepartments.length > 0) {
      await db.$executeRaw`
        UPDATE departments AS d SET name = v.name
        FROM unnest(${renamedDepartments.map(({ code }) => code)}::int[],
                    ${renamedDepartments.map(({ to }) => to)}::text[]) AS v(code, name)
        WHERE d.code = v.code`;
    }
    const rows = await db.department.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    return new Map(rows.map(({ code, id }) => [code, id]));
  }

  /** New employees, active, marked with this import. Returns their ids by employee number. */
  async createEmployees(
    employees: EmployeeWrite[],
    batchId: string,
    db: Db,
  ): Promise<Map<string, string>> {
    if (employees.length === 0) return new Map();
    const rows = await db.employee.createManyAndReturn({
      data: employees.map((employee) => ({
        employeeNumber: employee.employeeNumber,
        idNumber: employee.idNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
        departmentId: employee.departmentId,
        email: employee.email,
        emailStatus: employee.emailStatus,
        ...detailsToData(employee),
        isActive: employee.isActive,
        lastImportId: batchId,
      })),
      select: { id: true, employeeNumber: true },
    });
    return new Map(rows.map(({ employeeNumber, id }) => [employeeNumber, id]));
  }

  /**
   * Updates the changed employees in one statement, matched by employee number: every field the
   * Har Gal export carries, the email status and `last_import_id`. Never `is_active`. The extra
   * details are written as planned (an empty cell already kept the stored value). Returns their
   * ids by employee number.
   */
  async updateEmployees(
    employees: EmployeeWrite[],
    batchId: string,
    db: Db,
  ): Promise<Map<string, string>> {
    if (employees.length === 0) return new Map();
    const column = <T>(pick: (employee: EmployeeWrite) => T) => employees.map(pick);
    const rows = await db.$queryRaw<{ id: string; employeeNumber: string }[]>`
      UPDATE employees AS e SET
        id_number = v.id_number,
        first_name = v.first_name,
        last_name = v.last_name,
        department_id = v.department_id,
        email = v.email,
        email_status = v.email_status::email_status,
        landline = v.landline,
        mobile = v.mobile,
        address = v.address,
        city = v.city,
        birth_date = v.birth_date,
        job_title = v.job_title,
        employment_status = v.employment_status,
        job_percent = v.job_percent,
        work_days = v.work_days,
        hours_base_code = v.hours_base_code,
        pension_fund_a = v.pension_fund_a,
        pension_fund_b = v.pension_fund_b,
        study_fund = v.study_fund,
        last_import_id = ${batchId}::uuid
      FROM unnest(
        ${column((e) => e.employeeNumber)}::text[],
        ${column((e) => e.idNumber)}::text[],
        ${column((e) => e.firstName)}::text[],
        ${column((e) => e.lastName)}::text[],
        ${column((e) => e.departmentId)}::uuid[],
        ${column((e) => e.email)}::text[],
        ${column((e) => e.emailStatus)}::text[],
        ${column((e) => e.landline)}::text[],
        ${column((e) => e.mobile)}::text[],
        ${column((e) => e.address)}::text[],
        ${column((e) => e.city)}::text[],
        ${column((e) => e.birthDate)}::date[],
        ${column((e) => e.jobTitle)}::text[],
        ${column((e) => e.employmentStatus)}::text[],
        ${column((e) => e.jobPercent)}::numeric[],
        ${column((e) => e.workDays)}::text[],
        ${column((e) => e.hoursBaseCode)}::smallint[],
        ${column((e) => e.pensionFundA)}::text[],
        ${column((e) => e.pensionFundB)}::text[],
        ${column((e) => e.studyFund)}::text[]
      ) AS v(employee_number, id_number, first_name, last_name, department_id, email,
             email_status, landline, mobile, address, city, birth_date, job_title,
             employment_status, job_percent, work_days, hours_base_code, pension_fund_a,
             pension_fund_b, study_fund)
      WHERE e.employee_number = v.employee_number
      RETURNING e.id, e.employee_number AS "employeeNumber"`;
    return new Map(rows.map(({ employeeNumber, id }) => [employeeNumber, id]));
  }

  /** The batch becomes `committed` with its final counts; `committed_at` by the database clock. */
  async markCommitted(batchId: string, counts: ImportDiff['counts'], db: Db): Promise<Date> {
    const rows = await db.$queryRaw<{ committedAt: Date }[]>`
      UPDATE import_batches SET
        status = 'committed',
        rows_total = ${counts.rowsTotal},
        rows_created = ${counts.rowsNew},
        rows_updated = ${counts.rowsUpdated},
        rows_unchanged = ${counts.rowsUnchanged},
        rows_failed = ${counts.rowsFailed},
        committed_at = now()
      WHERE id = ${batchId}::uuid
      RETURNING committed_at AS "committedAt"`;
    const [row] = rows;
    if (!row) throw new Error(`Import batch ${batchId} vanished during its confirm`);
    return row.committedAt;
  }

  /** A refused preview becomes `failed`, only if it is still `preview`. True when it changed. */
  async markFailed(batchId: string, db: Db = this.prisma): Promise<boolean> {
    const { count } = await db.importBatch.updateMany({
      where: { id: batchId, status: 'preview' },
      data: { status: 'failed' },
    });
    return count > 0;
  }
}
