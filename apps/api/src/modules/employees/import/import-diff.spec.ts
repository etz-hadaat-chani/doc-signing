import { importIssue } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import type { EmployeeState } from '../employee-changes.js';
import { compareWithCurrent, type CurrentData, planImport } from './import-diff.js';
import type { CheckedRow, ImportedEmployee } from './import-row.js';

const stored: EmployeeState = {
  employeeNumber: '1001',
  idNumber: '012345674',
  firstName: 'דנה',
  lastName: 'כהן',
  departmentCode: 15,
  email: 'dana@example.com',
  emailStatus: 'bounced',
  phone: '050-1234567',
  isActive: false,
};

const same: ImportedEmployee = {
  employeeNumber: '1001',
  idNumber: '012345674',
  firstName: 'דנה',
  lastName: 'כהן',
  departmentCode: 15,
  departmentName: 'ירושלים',
  email: 'dana@example.com',
  phone: '050-1234567',
};

function row(rowNumber: number, employee: ImportedEmployee, extra: Partial<CheckedRow> = {}) {
  return {
    rowNumber,
    employeeNumber: employee.employeeNumber,
    idNumber: employee.idNumber,
    department: { code: employee.departmentCode, name: employee.departmentName },
    employee,
    errors: [],
    warnings: [],
    ...extra,
  } satisfies CheckedRow;
}

const current: CurrentData = {
  employees: new Map([['1001', stored]]),
  idOwners: new Map([['012345674', '1001']]),
  departments: new Map([
    [15, 'ירושלים'],
    [19, 'חינוך מיוחד'],
  ]),
};

describe('compareWithCurrent', () => {
  it('counts an identical row as unchanged: a bounced email stays bounced, isActive stays as stored', () => {
    const diff = compareWithCurrent([row(2, same)], current);
    expect(diff.counts).toMatchObject({ rowsTotal: 1, rowsUnchanged: 1, rowsUpdated: 0 });
    expect(diff.updatedEmployees).toEqual([]);
  });

  it('lists every change of an updated employee as "field: old → new"', () => {
    const changed = {
      ...same,
      idNumber: '023456783',
      departmentCode: 19,
      departmentName: 'חינוך מיוחד',
      email: 'dana.cohen@example.com',
      phone: null,
    };
    const diff = compareWithCurrent([row(2, changed)], current);
    expect(diff.updatedEmployees).toEqual([
      {
        row: 2,
        employeeNumber: '1001',
        fullName: 'דנה כהן',
        changes: [
          'idNumber: changed',
          'departmentCode: 15 → 19',
          'email: dana@example.com → dana.cohen@example.com',
          'emailStatus: bounced → valid',
          'phone: 050-1234567 → (none)',
        ],
      },
    ]);
  });

  it('lists a new employee with the department from the file', () => {
    const fresh = {
      ...same,
      employeeNumber: '2001',
      idNumber: '034567891',
      departmentCode: 45,
      departmentName: 'ממלאות מקום אלעד-45',
      email: null,
    };
    const diff = compareWithCurrent([row(3, fresh)], current);
    expect(diff.newEmployees).toEqual([
      {
        row: 3,
        employeeNumber: '2001',
        fullName: 'דנה כהן',
        department: '45 - ממלאות מקום אלעד-45',
        emailStatus: 'missing',
      },
    ]);
    expect(diff.newDepartments).toEqual([{ code: 45, name: 'ממלאות מקום אלעד-45' }]);
  });

  it('gives a new employee with a bad email the status invalid', () => {
    const fresh = { ...same, employeeNumber: '2001', idNumber: '034567891', email: 'dana@' };
    const diff = compareWithCurrent([row(3, fresh)], current);
    expect(diff.newEmployees[0]?.emailStatus).toBe('invalid');
  });

  it('lists a renamed department (known code, new name)', () => {
    const diff = compareWithCurrent(
      [row(2, { ...same, departmentName: 'ירושלים החדשה' })],
      current,
    );
    expect(diff.renamedDepartments).toEqual([{ code: 15, from: 'ירושלים', to: 'ירושלים החדשה' }]);
    expect(diff.counts.departmentsRenamed).toBe(1);
    expect(diff.counts.rowsUnchanged).toBe(1);
  });

  it('fails a row whose ID belongs to another employee', () => {
    const other = { ...same, employeeNumber: '2001' };
    const diff = compareWithCurrent([row(4, other)], current);
    expect(diff.counts.rowsFailed).toBe(1);
    expect(diff.errors).toEqual([
      {
        row: 4,
        employeeNumber: '2001',
        code: 'ID_NUMBER_TAKEN',
        message: 'מספר תעודת הזהות כבר רשום לעובד אחר (מספר עובד 1001)',
      },
    ]);
  });

  it('lists failed rows with their reasons, and warnings only for imported rows', () => {
    const bad = row(5, same, {
      employee: null,
      errors: [importIssue('DEPARTMENT_INVALID')],
      warnings: [importIssue('PHONE_INVALID')],
    });
    const warned = row(
      6,
      { ...same, employeeNumber: '2002', idNumber: '034567891' },
      {
        warnings: [importIssue('EMAIL_INVALID')],
      },
    );
    const diff = compareWithCurrent([bad, warned], current);
    expect(diff.counts).toMatchObject({ rowsTotal: 2, rowsFailed: 1, rowsNew: 1 });
    expect(diff.errors.map(({ row: n, code }) => [n, code])).toEqual([[5, 'DEPARTMENT_INVALID']]);
    expect(diff.warnings.map(({ row: n, code }) => [n, code])).toEqual([[6, 'EMAIL_INVALID']]);
  });

  it('takes new and renamed departments only from rows that will be imported', () => {
    const bad = row(
      5,
      { ...same, departmentCode: 77, departmentName: 'x' },
      {
        errors: [importIssue('FIRST_NAME_MISSING')],
      },
    );
    const diff = compareWithCurrent([bad], current);
    expect(diff.newDepartments).toEqual([]);
  });
});

describe('planImport: the writes the confirm applies', () => {
  const fresh: ImportedEmployee = {
    ...same,
    employeeNumber: '2001',
    idNumber: '023456783',
    email: 'bad@@x',
    phone: null,
  };

  it('writes new and changed employees only; unchanged and failed rows are left out', () => {
    const changed = { ...same, firstName: 'דינה' };
    const failed = row(
      5,
      { ...fresh, employeeNumber: '2002' },
      {
        errors: [importIssue('FIRST_NAME_MISSING')],
      },
    );
    const plan = planImport([row(2, changed), row(3, fresh), failed], current);
    expect(plan.writes.creates.map((e) => e.employeeNumber)).toEqual(['2001']);
    expect(plan.writes.updates).toEqual([
      {
        after: { ...stored, firstName: 'דינה' },
        changes: ['firstName: דנה → דינה'],
      },
    ]);
    expect(planImport([row(2, same)], current).writes).toEqual({ creates: [], updates: [] });
  });

  it('imports a row with warnings: bad email → invalid, unreadable phone → empty', () => {
    const warned = row(3, fresh, {
      warnings: [importIssue('EMAIL_INVALID'), importIssue('PHONE_INVALID')],
    });
    const [created] = planImport([warned], current).writes.creates;
    expect(created).toMatchObject({ email: 'bad@@x', emailStatus: 'invalid', phone: null });
  });

  it('keeps isActive as stored (an inactive employee stays inactive); a new one is active', () => {
    const plan = planImport([row(2, { ...same, lastName: 'לוי' }), row(3, fresh)], current);
    expect(plan.writes.updates[0]?.after.isActive).toBe(false);
    expect(plan.writes.creates[0]?.isActive).toBe(true);
  });

  it('report and writes come from the same loop: counts match the writes', () => {
    const plan = planImport([row(2, { ...same, lastName: 'לוי' }), row(3, fresh)], current);
    expect(plan.diff.counts.rowsNew).toBe(plan.writes.creates.length);
    expect(plan.diff.counts.rowsUpdated).toBe(plan.writes.updates.length);
    expect(plan.diff.updatedEmployees.map((e) => e.changes)).toEqual(
      plan.writes.updates.map((u) => u.changes),
    );
  });
});
