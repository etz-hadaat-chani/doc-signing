import {
  EMPLOYEE_EXTRA_FIELDS,
  type EmployeeExtraField,
  HAR_GAL_EXTRA_HEADERS,
  HAR_GAL_HEADERS,
  type HarGalColumn,
  IMPORT_MAX_ROWS,
} from '@doc-signing/shared';
import { HttpStatus } from '@nestjs/common';
import type { Workbook, Worksheet } from 'exceljs';
import { AppException } from '../../../common/errors/app.exception.js';
import { type CellData, plainText, readCell } from './excel-cell.js';

/** The header row is looked for in the first rows, in case the export has a title line. */
const HEADER_SEARCH_ROWS = 10;

const COLUMNS = Object.keys(HAR_GAL_HEADERS) as HarGalColumn[];

/**
 * One data row: its Excel row number, the visible value of each of the 10 required columns, and of
 * each optional extra column (null when the cell is empty or the column isn't in the file).
 */
export interface SheetRow {
  rowNumber: number;
  cells: Record<HarGalColumn, CellData>;
  extras: Record<EmployeeExtraField, CellData>;
}

/** Where each column is: the 10 required ones always, an extra one only when the file has it. */
interface ColumnMap {
  required: Record<HarGalColumn, number>;
  extras: Partial<Record<EmployeeExtraField, number>>;
}

function fileError(code: 'IMPORT_MISSING_COLUMNS' | 'IMPORT_DUPLICATE_COLUMN', columns: string[]) {
  return new AppException(code, HttpStatus.BAD_REQUEST, { columns });
}

function headerText(sheet: Worksheet, rowNumber: number, column: number): string | null {
  return plainText(readCell(sheet.getRow(rowNumber).getCell(column).value));
}

/** The first row (of the first 10) with a "מספר עובד" cell; null when there is none. */
function findHeaderRow(sheet: Worksheet): number | null {
  const last = Math.min(sheet.rowCount, HEADER_SEARCH_ROWS);
  for (let rowNumber = 1; rowNumber <= last; rowNumber++) {
    for (let column = 1; column <= sheet.getRow(rowNumber).cellCount; column++) {
      if (headerText(sheet, rowNumber, column) === HAR_GAL_HEADERS.employeeNumber) return rowNumber;
    }
  }
  return null;
}

/** Header text → the column numbers that carry it, in the header row. */
function headerColumns(sheet: Worksheet, headerRow: number | null): Map<string, number[]> {
  const found = new Map<string, number[]>();
  if (headerRow === null) return found;
  for (let column = 1; column <= sheet.getRow(headerRow).cellCount; column++) {
    const text = headerText(sheet, headerRow, column);
    if (text !== null) found.set(text, [...(found.get(text) ?? []), column]);
  }
  return found;
}

/**
 * Each column → its column number, by exact header text (trimmed), in any order. Other columns
 * are ignored. A missing required header → 400 IMPORT_MISSING_COLUMNS; a missing extra one is
 * fine (FR-EMP-1). Any of these headers twice → 400 IMPORT_DUPLICATE_COLUMN. Both errors name the
 * headers in `details.columns`.
 */
function mapColumns(sheet: Worksheet, headerRow: number | null): ColumnMap {
  const found = headerColumns(sheet, headerRow);
  const missing = COLUMNS.map((key) => HAR_GAL_HEADERS[key]).filter((h) => !found.has(h));
  if (missing.length > 0) throw fileError('IMPORT_MISSING_COLUMNS', missing);
  const known = [...Object.values(HAR_GAL_HEADERS), ...Object.values(HAR_GAL_EXTRA_HEADERS)];
  const twice = known.filter((header) => (found.get(header)?.length ?? 0) > 1);
  if (twice.length > 0) throw fileError('IMPORT_DUPLICATE_COLUMN', twice);
  const columnOf = (header: string) => found.get(header)?.[0] ?? 0;
  return {
    required: Object.fromEntries(
      COLUMNS.map((key) => [key, columnOf(HAR_GAL_HEADERS[key])]),
    ) as Record<HarGalColumn, number>,
    extras: Object.fromEntries(
      EMPLOYEE_EXTRA_FIELDS.flatMap((key) => {
        const column = columnOf(HAR_GAL_EXTRA_HEADERS[key]);
        return column === 0 ? [] : [[key, column]];
      }),
    ),
  };
}

/**
 * Reads the Har Gal export: the first worksheet, the header row, then every row below it. A row
 * whose 10 required columns are all empty is skipped (not counted, not an error). More than
 * IMPORT_MAX_ROWS rows → 400 IMPORT_TOO_MANY_ROWS; none → 400 IMPORT_NO_ROWS.
 */
export function readHarGalSheet(workbook: Workbook): SheetRow[] {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppException('IMPORT_NO_ROWS', HttpStatus.BAD_REQUEST);
  const headerRow = findHeaderRow(sheet);
  const columns = mapColumns(sheet, headerRow);
  const rows: SheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (headerRow === null || rowNumber <= headerRow) return;
    const cells = Object.fromEntries(
      COLUMNS.map((key) => [key, readCell(row.getCell(columns.required[key]).value)]),
    ) as Record<HarGalColumn, CellData>;
    if (Object.values(cells).every((cell) => cell === null)) return;
    const extras = Object.fromEntries(
      EMPLOYEE_EXTRA_FIELDS.map((key) => {
        const column = columns.extras[key];
        const dates = key === 'birthDate';
        return [key, column === undefined ? null : readCell(row.getCell(column).value, { dates })];
      }),
    ) as Record<EmployeeExtraField, CellData>;
    if (rows.length === IMPORT_MAX_ROWS) {
      throw new AppException('IMPORT_TOO_MANY_ROWS', HttpStatus.BAD_REQUEST, {
        maxRows: IMPORT_MAX_ROWS,
      });
    }
    rows.push({ rowNumber, cells, extras });
  });
  if (rows.length === 0) throw new AppException('IMPORT_NO_ROWS', HttpStatus.BAD_REQUEST);
  return rows;
}
