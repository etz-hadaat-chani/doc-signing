import {
  EMAIL_MAX_LENGTH,
  EMPLOYEE_NAME_MAX_LENGTH,
  type EmployeeExtras,
  type ImportIssueCode,
  importIssue,
  isEmailFormat,
  isValidIdNumber,
  normalizeEmail,
  normalizeEmployeeNumber,
  normalizeIdNumber,
  normalizePhone,
  parseDepartmentCell,
} from '@doc-signing/shared';
import { type CellData, digitsText, plainText } from './excel-cell.js';
import type { SheetRow } from './har-gal-sheet.js';
import { checkExtras } from './import-extras.js';

export interface ImportIssue {
  code: ImportIssueCode;
  message: string;
}

/** A row that passed every field check, normalized as it would be saved. */
export interface ImportedEmployee {
  employeeNumber: string;
  idNumber: string;
  firstName: string;
  lastName: string;
  departmentCode: number;
  departmentName: string;
  email: string | null;
  landline: string | null;
  mobile: string | null;
  /** Only the filled, usable extra cells; a field left out keeps the stored value. */
  extras: Partial<EmployeeExtras>;
}

/**
 * One row after the field checks. The readable keys (employee number, valid ID, department) are
 * kept even when another field failed, so the whole-file checks can still find repeats.
 * `employee` is set only when no field failed; whole-file checks may add errors later.
 */
export interface CheckedRow {
  rowNumber: number;
  employeeNumber: string | null;
  idNumber: string | null;
  department: { code: number; name: string } | null;
  employee: ImportedEmployee | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

function checkEmployeeNumber(cell: CellData, errors: ImportIssue[]): string | null {
  if (cell === null) {
    errors.push(importIssue('EMPLOYEE_NUMBER_MISSING'));
    return null;
  }
  const text = digitsText(cell);
  const number = text === null ? null : normalizeEmployeeNumber(text);
  if (number === null) errors.push(importIssue('EMPLOYEE_NUMBER_INVALID'));
  return number;
}

/** Text or a number; the leading zeros come back (normalizeIdNumber); check digit checked. */
function checkIdNumber(cell: CellData, errors: ImportIssue[]): string | null {
  if (cell === null) {
    errors.push(importIssue('ID_NUMBER_MISSING'));
    return null;
  }
  const text = digitsText(cell);
  const id = text === null ? null : normalizeIdNumber(text);
  if (id === null || !isValidIdNumber(id)) {
    errors.push(importIssue('ID_NUMBER_INVALID'));
    return null;
  }
  return id;
}

function checkName(
  cell: CellData,
  missing: 'FIRST_NAME_MISSING' | 'LAST_NAME_MISSING',
  tooLong: 'FIRST_NAME_TOO_LONG' | 'LAST_NAME_TOO_LONG',
  errors: ImportIssue[],
): string | null {
  const name = plainText(cell);
  if (name === null) {
    errors.push(importIssue(missing));
    return null;
  }
  if (name.length > EMPLOYEE_NAME_MAX_LENGTH) {
    errors.push(importIssue(tooLong));
    return null;
  }
  return name;
}

function checkDepartment(cell: CellData, errors: ImportIssue[]) {
  const text = plainText(cell);
  if (text === null) {
    errors.push(importIssue('DEPARTMENT_MISSING'));
    return null;
  }
  const department = parseDepartmentCell(text);
  if (department === null) errors.push(importIssue('DEPARTMENT_INVALID'));
  return department;
}

/**
 * Empty → no email. A wrong format is not an error: the employee is saved with email status
 * `invalid` (FR-EMP-4) and the row gets a warning. Too long for the column → error.
 */
function checkEmail(
  cell: CellData,
  errors: ImportIssue[],
  warnings: ImportIssue[],
): string | null | undefined {
  const email = normalizeEmail(plainText(cell));
  if (email === null) return null;
  if (email.length > EMAIL_MAX_LENGTH) {
    errors.push(importIssue('EMAIL_TOO_LONG'));
    return undefined;
  }
  if (!isEmailFormat(email)) warnings.push(importIssue('EMAIL_INVALID'));
  return email;
}

/**
 * One phone: prefix + number, as `050-1234567` (normalizePhone puts back the 0 of a prefix sent
 * as the number 50). An empty number cell → no phone (it clears the stored one). A phone that
 * can't be read is a warning of its own and is saved empty.
 */
function checkPhone(
  prefix: CellData,
  number: CellData,
  invalid: 'LANDLINE_INVALID' | 'MOBILE_INVALID',
  warnings: ImportIssue[],
): string | null {
  if (number === null) return null;
  const prefixText = prefix === null ? '' : digitsText(prefix);
  const numberText = digitsText(number);
  const phone =
    prefixText === null || numberText === null ? null : normalizePhone(prefixText + numberText);
  if (phone === null) warnings.push(importIssue(invalid));
  return phone;
}

/** Checks every field of one row (FR-EMP-1, FR-EMP-3); all reasons are listed, not just the first. */
export function checkRow(row: SheetRow): CheckedRow {
  const { rowNumber, cells } = row;
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const employeeNumber = checkEmployeeNumber(cells.employeeNumber, errors);
  const idNumber = checkIdNumber(cells.idNumber, errors);
  const firstName = checkName(cells.firstName, 'FIRST_NAME_MISSING', 'FIRST_NAME_TOO_LONG', errors);
  const lastName = checkName(cells.lastName, 'LAST_NAME_MISSING', 'LAST_NAME_TOO_LONG', errors);
  const department = checkDepartment(cells.department, errors);
  const email = checkEmail(cells.email, errors, warnings);
  const landline = checkPhone(cells.landlinePrefix, cells.landline, 'LANDLINE_INVALID', warnings);
  const mobile = checkPhone(cells.mobilePrefix, cells.mobile, 'MOBILE_INVALID', warnings);
  const extras = checkExtras(row.extras, warnings);
  const employee =
    errors.length === 0 &&
    employeeNumber !== null &&
    idNumber !== null &&
    firstName !== null &&
    lastName !== null &&
    department !== null &&
    email !== undefined
      ? {
          employeeNumber,
          idNumber,
          firstName,
          lastName,
          departmentCode: department.code,
          departmentName: department.name,
          email,
          landline,
          mobile,
          extras,
        }
      : null;
  return { rowNumber, employeeNumber, idNumber, department, employee, errors, warnings };
}
