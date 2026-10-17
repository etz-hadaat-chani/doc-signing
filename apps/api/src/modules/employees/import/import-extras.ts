import {
  EMPLOYEE_EXTRA_FIELDS,
  type EmployeeExtraField,
  type EmployeeExtras,
  employeeExtraValueSchemas,
  HAR_GAL_EXTRA_HEADERS,
  importIssue,
} from '@doc-signing/shared';
import { type CellData, plainText } from './excel-cell.js';
import type { ImportIssue } from './import-row.js';

/** A birth date typed as text: `DD/MM/YYYY` or `DD.MM.YYYY`. */
const DAY_TEXT = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;

/** A number typed as text, e.g. "50" or "62.5". */
const NUMBER_TEXT = /^\d+(\.\d+)?$/;

/** A birth date cell: an Excel date cell, or text as DD/MM/YYYY. Anything else is unreadable. */
function birthDateValue(cell: NonNullable<CellData>): string | undefined {
  if (cell.kind === 'date') return cell.value;
  const match = cell.kind === 'text' ? DAY_TEXT.exec(cell.value) : null;
  if (!match) return undefined;
  const [, day = '', month = '', year = ''] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** A number cell, or text that is a plain number. Anything else is unreadable. */
function numberValue(cell: NonNullable<CellData>): number | undefined {
  if (cell.kind === 'number') return cell.value;
  return cell.kind === 'text' && NUMBER_TEXT.test(cell.value) ? Number(cell.value) : undefined;
}

function cellValue(field: EmployeeExtraField, cell: NonNullable<CellData>): unknown {
  if (field === 'birthDate') return birthDateValue(cell);
  if (field === 'jobPercent' || field === 'hoursBaseCode') return numberValue(cell);
  return plainText(cell);
}

/**
 * The filled extra cells that pass the same rule as the API (`employeeExtraValueSchemas`). An
 * empty cell or a missing column is left out, so the stored value is kept (FR-EMP-4). A cell
 * that can't be used (not a date, a future birth date, not a number, too long) is left out too,
 * with a warning naming its column; the row is still imported.
 */
export function checkExtras(
  extras: Record<EmployeeExtraField, CellData>,
  warnings: ImportIssue[],
): Partial<EmployeeExtras> {
  const values: Partial<Record<EmployeeExtraField, string | number>> = {};
  for (const field of EMPLOYEE_EXTRA_FIELDS) {
    const cell = extras[field];
    if (cell === null) continue;
    const parsed = employeeExtraValueSchemas[field].safeParse(cellValue(field, cell));
    if (parsed.success) values[field] = parsed.data;
    else warnings.push(importIssue('EXTRA_VALUE_INVALID', HAR_GAL_EXTRA_HEADERS[field]));
  }
  return values as Partial<EmployeeExtras>;
}
