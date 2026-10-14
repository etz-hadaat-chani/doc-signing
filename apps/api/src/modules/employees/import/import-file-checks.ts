import { importIssue } from '@doc-signing/shared';
import type { CheckedRow, ImportIssue } from './import-row.js';

/** Rows grouped by a key; rows without one are left out. */
function groupBy<K>(
  rows: CheckedRow[],
  keyOf: (row: CheckedRow) => K | null,
): Map<K, CheckedRow[]> {
  const groups = new Map<K, CheckedRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

/** Every row whose key appears in more than one row gets an error naming the other rows. */
function flagRepeats(
  rows: CheckedRow[],
  keyOf: (row: CheckedRow) => string | null,
  issueFor: (otherRows: number[]) => ImportIssue,
): void {
  for (const group of groupBy(rows, keyOf).values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      const others = group.filter((other) => other !== row).map((other) => other.rowNumber);
      row.errors.push(issueFor(others));
    }
  }
}

/** A department code with different names in one file: every row of that code is an error. */
function flagDepartmentConflicts(rows: CheckedRow[]): void {
  for (const [code, group] of groupBy(rows, (row) => row.department?.code ?? null)) {
    const names = [...new Set(group.map((row) => row.department?.name ?? ''))];
    if (names.length < 2) continue;
    for (const row of group) row.errors.push(importIssue('DEPARTMENT_NAME_CONFLICT', code, names));
  }
}

/**
 * The checks that need the whole file (FR-EMP-3): an employee number or ID number repeated in
 * several rows, and one department code under different names. Adds errors to the rows, in place.
 * Rows that already failed a field check still count, so their partners are flagged too. The ID
 * number itself never appears in a message.
 */
export function checkWholeFile(rows: CheckedRow[]): void {
  flagRepeats(
    rows,
    (row) => row.employeeNumber,
    (others) => importIssue('DUPLICATE_EMPLOYEE_NUMBER', others),
  );
  flagRepeats(
    rows,
    (row) => row.idNumber,
    (others) => importIssue('DUPLICATE_ID_NUMBER', others),
  );
  flagDepartmentConflicts(rows);
}
