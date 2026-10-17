import {
  type CreateEmployeeInput,
  type Department,
  type EmployeeCard,
  type EmployeeListItem,
  type EmployeeListQuery,
  nextEmailStatus,
  type Paged,
  type UpdateEmployeeInput,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import { describeEmployeeChanges, type EmployeeState } from './employee-changes.js';
import { buildCard, newDetails, readState } from './employee-details.js';
import {
  detailsToData,
  employeeCardSelect,
  type EmployeeCardRow,
  type EmployeeListRow,
  EmployeesRepository,
  sentDetails,
} from './employees.repository.js';

/** The manager making a change: who, from where. */
export interface EmployeeActor {
  userId: string;
  ip: string | null;
}

function toListItem(row: EmployeeListRow): EmployeeListItem {
  return {
    id: row.id,
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    department: { id: row.departmentId, code: row.departmentCode, name: row.departmentName },
    email: row.email,
    emailStatus: row.emailStatus,
    isActive: row.isActive,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Employees (FR-EMP-4, FR-EMP-6, FR-EMP-7): list, card, add and edit one. Never deletes; a
 * manager marks an employee inactive instead. Saving an email never sends anything.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: EmployeesRepository,
    private readonly audit: AuditService,
  ) {}

  /** Every department, sorted by code (PRD §7). A short list for filters and forms: no paging. */
  async listDepartments(): Promise<Department[]> {
    return this.prisma.department.findMany({
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async list(query: EmployeeListQuery): Promise<Paged<EmployeeListItem>> {
    const { rows, total } = await this.repository.list(query);
    return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize };
  }

  async card(id: string): Promise<EmployeeCard> {
    const row = await this.prisma.employee.findUnique({
      where: { id },
      select: employeeCardSelect,
    });
    if (!row) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return buildCard(row);
  }

  /** Adds one employee (active) and logs it, together. */
  async create(input: CreateEmployeeInput, actor: EmployeeActor): Promise<EmployeeCard> {
    const email = input.email ?? null;
    const emailStatus = nextEmailStatus(null, email);
    const keys = { employeeNumber: input.employeeNumber, idNumber: input.idNumber };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const department = await this.findDepartment(input.departmentId, tx);
        await this.assertFree(keys, undefined, tx);
        const employee = await tx.employee.create({
          data: {
            ...keys,
            firstName: input.firstName,
            lastName: input.lastName,
            departmentId: department.id,
            email,
            emailStatus,
            ...detailsToData(newDetails(input)),
          },
          select: employeeCardSelect,
        });
        await this.audit.record(
          {
            actor: { type: 'user', userId: actor.userId },
            action: 'employee.created',
            entity: { type: 'employee', id: employee.id },
            ip: actor.ip,
            details: {
              employeeNumber: employee.employeeNumber,
              fullName: `${employee.firstName} ${employee.lastName}`,
              departmentCode: department.code,
              emailStatus,
            },
          },
          tx,
        );
        return buildCard(employee);
      });
    } catch (error) {
      // The same number or ID saved at the same moment by another request: say which one.
      if (isUniqueViolation(error)) await this.assertFree(keys);
      throw error;
    }
  }

  /**
   * Edits one employee and logs every changed field ("field: old → new", never the ID number's
   * value). The row is locked first, so the change list is exact. A department change moves only
   * the employee: existing assignments keep the department they had when sent.
   */
  async update(
    id: string,
    input: UpdateEmployeeInput,
    actor: EmployeeActor,
  ): Promise<EmployeeCard> {
    try {
      const saved = await this.prisma.$transaction((db) => this.applyEdit(id, input, actor, db));
      return saved;
    } catch (failure) {
      await this.explainIdClash(failure, input, id);
      throw failure;
    }
  }

  /** The edit itself, inside the transaction: lock, check, compare, save, log. */
  private async applyEdit(
    id: string,
    input: UpdateEmployeeInput,
    actor: EmployeeActor,
    db: Db,
  ): Promise<EmployeeCard> {
    const stored = await this.repository.lockEmployee(id, db);
    if (!stored) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    const department = await this.departmentFor(input, stored, db);
    await this.checkNewIdNumber(input, stored, db);
    const wanted = this.editedState(input, stored, department.code);
    const lines = describeEmployeeChanges(readState(stored), wanted);
    if (lines.length === 0) return buildCard(stored);
    const row = await this.saveEdit(id, wanted, department.id, db);
    await this.logEdit(id, lines, actor, db);
    return buildCard(row);
  }

  /** The department after the edit: the stored one, or the new one (which must exist). */
  private async departmentFor(
    input: UpdateEmployeeInput,
    stored: EmployeeCardRow,
    db: Db,
  ): Promise<{ id: string; code: number }> {
    if (input.departmentId === undefined || input.departmentId === stored.department.id) {
      return stored.department;
    }
    return this.findDepartment(input.departmentId, db);
  }

  /** A new ID number must not belong to another employee (409). */
  private async checkNewIdNumber(
    input: UpdateEmployeeInput,
    stored: EmployeeCardRow,
    db: Db,
  ): Promise<void> {
    if (input.idNumber === undefined || input.idNumber === stored.idNumber) return;
    await this.assertFree({ idNumber: input.idNumber }, stored.id, db);
  }

  /** The employee as the edit leaves them; fields not sent keep their stored value. */
  private editedState(
    input: UpdateEmployeeInput,
    stored: EmployeeCardRow,
    departmentCode: number,
  ): EmployeeState {
    const before = readState(stored);
    const email = input.email === undefined ? before.email : input.email;
    const emailStatus =
      input.email === undefined ? before.emailStatus : nextEmailStatus(before, email);
    return {
      ...before,
      idNumber: input.idNumber ?? before.idNumber,
      firstName: input.firstName ?? before.firstName,
      lastName: input.lastName ?? before.lastName,
      departmentCode,
      email,
      emailStatus,
      ...sentDetails(input),
      isActive: input.isActive ?? before.isActive,
    };
  }

  /** Writes the edited fields. The employee number is never part of an edit. */
  private saveEdit(
    id: string,
    wanted: EmployeeState,
    departmentId: string,
    db: Db,
  ): Promise<EmployeeCardRow> {
    return db.employee.update({
      where: { id },
      data: {
        idNumber: wanted.idNumber,
        firstName: wanted.firstName,
        lastName: wanted.lastName,
        departmentId,
        email: wanted.email,
        emailStatus: wanted.emailStatus,
        ...detailsToData(wanted),
        isActive: wanted.isActive,
      },
      select: employeeCardSelect,
    });
  }

  /** One `employee.updated` row with the change lines (the ID only as "idNumber: changed"). */
  private logEdit(id: string, lines: string[], actor: EmployeeActor, db: Db): Promise<void> {
    return this.audit.record(
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'employee.updated',
        entity: { type: 'employee', id },
        ip: actor.ip,
        details: { changes: lines },
      },
      db,
    );
  }

  /**
   * After a unique-index failure (another request saved the same ID at the same moment), throws
   * the specific 409. Returns quietly for any other failure, so the caller rethrows it.
   */
  private async explainIdClash(
    failure: unknown,
    input: UpdateEmployeeInput,
    id: string,
  ): Promise<void> {
    if (!isUniqueViolation(failure) || input.idNumber === undefined) return;
    await this.assertFree({ idNumber: input.idNumber }, id);
  }

  private async findDepartment(
    id: string,
    db: Db,
  ): Promise<{ id: string; code: number; name: string }> {
    const department = await db.department.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
    if (!department) throw new AppException('DEPARTMENT_NOT_FOUND', HttpStatus.BAD_REQUEST);
    return department;
  }

  /** 409 when another employee (not `exceptId`) already has this employee number or ID number. */
  private async assertFree(
    { employeeNumber, idNumber }: { employeeNumber?: string; idNumber?: string },
    exceptId?: string,
    db: Db = this.prisma,
  ): Promise<void> {
    const others = exceptId === undefined ? {} : { id: { not: exceptId } };
    if (employeeNumber !== undefined) {
      const taken = await db.employee.findFirst({
        where: { employeeNumber, ...others },
        select: { id: true },
      });
      if (taken) throw new AppException('EMPLOYEE_NUMBER_TAKEN', HttpStatus.CONFLICT);
    }
    if (idNumber !== undefined) {
      const taken = await db.employee.findFirst({
        where: { idNumber, ...others },
        select: { id: true },
      });
      if (taken) throw new AppException('ID_NUMBER_TAKEN', HttpStatus.CONFLICT);
    }
  }
}
