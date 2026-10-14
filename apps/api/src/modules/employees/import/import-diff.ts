import {
  formatDepartment,
  type ImportPreview,
  type ImportRowIssue,
  importIssue,
  nextEmailStatus,
} from '@doc-signing/shared';
import { describeEmployeeChanges, type EmployeeState } from '../employee-changes.js';
import type { CheckedRow, ImportedEmployee, ImportIssue } from './import-row.js';

/** What the database holds now, for the employees and departments the file names. */
export interface CurrentData {
  /** By employee number: the employees whose number is in the file. */
  employees: ReadonlyMap<string, EmployeeState>;
  /** ID number → employee number, for every stored employee whose ID is in the file. */
  idOwners: ReadonlyMap<string, string>;
  /** Code → name, for the department codes in the file. */
  departments: ReadonlyMap<number, string>;
}

export type ImportDiff = Omit<ImportPreview, 'batchId' | 'fileName'>;

/**
 * What the confirm writes (3.4), built in the same loop as the report, so it applies exactly
 * what the preview showed. Unchanged employees and failed rows are not in it.
 */
export interface ImportWrites {
  /** New employees, as the import leaves them. */
  creates: EmployeeState[];
  /** Changed employees: the state after the import and the change lines for the log. */
  updates: { after: EmployeeState; changes: string[] }[];
}

export interface ImportPlan {
  diff: ImportDiff;
  writes: ImportWrites;
}

function rowIssues(row: CheckedRow, issues: ImportIssue[]): ImportRowIssue[] {
  return issues.map((issue) => ({
    row: row.rowNumber,
    employeeNumber: row.employeeNumber,
    ...issue,
  }));
}

/**
 * The employee as the import would leave them. Har Gal is the main source (FR-EMP-4): every field
 * the export carries is taken from the file. `isActive` is not in the export, so it stays as
 * stored (a new employee is active). Email status follows nextEmailStatus: same email → status
 * kept (bounced stays bounced), different → valid or invalid, empty → missing.
 */
export function importedState(
  employee: ImportedEmployee,
  stored: EmployeeState | undefined,
): EmployeeState {
  return {
    employeeNumber: employee.employeeNumber,
    idNumber: employee.idNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    departmentCode: employee.departmentCode,
    email: employee.email,
    emailStatus: nextEmailStatus(stored ?? null, employee.email),
    phone: employee.phone,
    isActive: stored?.isActive ?? true,
  };
}

/** The ID belongs to another stored employee: saving it would break the unique ID rule. */
function checkIdOwner(row: CheckedRow, employee: ImportedEmployee, current: CurrentData): void {
  const owner = current.idOwners.get(employee.idNumber);
  if (owner !== undefined && owner !== employee.employeeNumber) {
    row.errors.push(importIssue('ID_NUMBER_TAKEN', owner));
  }
}

/** New codes, and known codes under a new name, from the rows that will be imported. */
function departmentChanges(imported: ImportedEmployee[], current: CurrentData) {
  const inFile = new Map<number, string>();
  for (const employee of imported) inFile.set(employee.departmentCode, employee.departmentName);
  const codes = [...inFile.keys()].sort((a, b) => a - b);
  const newDepartments = codes
    .filter((code) => !current.departments.has(code))
    .map((code) => ({ code, name: inFile.get(code) ?? '' }));
  const renamedDepartments = codes.flatMap((code) => {
    const from = current.departments.get(code);
    const to = inFile.get(code) ?? '';
    return from !== undefined && from !== to ? [{ code, from, to }] : [];
  });
  return { newDepartments, renamedDepartments };
}

/** The preview's report only (see planImport). */
export function compareWithCurrent(rows: CheckedRow[], current: CurrentData): ImportDiff {
  return planImport(rows, current).diff;
}

/**
 * Compares the checked rows with the current data (FR-EMP-2): new = number not stored; updated =
 * at least one field differs, listed as "field: old → new" (the ID only as "idNumber: changed");
 * unchanged = no field differs. Rows with an error are failed and listed with every reason;
 * warnings are listed only for rows that will be imported. Returns the report and the writes
 * that apply it. Pure: reads nothing, saves nothing.
 */
export function planImport(rows: CheckedRow[], current: CurrentData): ImportPlan {
  for (const row of rows) {
    if (row.employee && row.errors.length === 0) checkIdOwner(row, row.employee, current);
  }
  const diff: ImportDiff = {
    counts: {
      rowsTotal: rows.length,
      rowsNew: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsFailed: 0,
      departmentsNew: 0,
      departmentsRenamed: 0,
    },
    newEmployees: [],
    updatedEmployees: [],
    newDepartments: [],
    renamedDepartments: [],
    errors: [],
    warnings: [],
  };
  const writes: ImportWrites = { creates: [], updates: [] };
  const imported: ImportedEmployee[] = [];
  for (const row of rows) {
    const { employee } = row;
    if (!employee || row.errors.length > 0) {
      diff.counts.rowsFailed++;
      diff.errors.push(...rowIssues(row, row.errors));
      continue;
    }
    imported.push(employee);
    diff.warnings.push(...rowIssues(row, row.warnings));
    const fullName = `${employee.firstName} ${employee.lastName}`;
    const stored = current.employees.get(employee.employeeNumber);
    const after = importedState(employee, stored);
    if (!stored) {
      diff.counts.rowsNew++;
      diff.newEmployees.push({
        row: row.rowNumber,
        employeeNumber: employee.employeeNumber,
        fullName,
        department: formatDepartment(employee.departmentCode, employee.departmentName),
        emailStatus: after.emailStatus,
      });
      writes.creates.push(after);
      continue;
    }
    const changes = describeEmployeeChanges(stored, after);
    if (changes.length === 0) {
      diff.counts.rowsUnchanged++;
      continue;
    }
    diff.counts.rowsUpdated++;
    diff.updatedEmployees.push({
      row: row.rowNumber,
      employeeNumber: employee.employeeNumber,
      fullName,
      changes,
    });
    writes.updates.push({ after, changes });
  }
  const departments = departmentChanges(imported, current);
  diff.newDepartments = departments.newDepartments;
  diff.renamedDepartments = departments.renamedDepartments;
  diff.counts.departmentsNew = departments.newDepartments.length;
  diff.counts.departmentsRenamed = departments.renamedDepartments.length;
  return { diff, writes };
}
