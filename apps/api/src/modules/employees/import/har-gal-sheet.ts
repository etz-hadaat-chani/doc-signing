import { HAR_GAL_HEADERS, type HarGalColumn, IMPORT_MAX_ROWS } from '@doc-signing/shared';
import { HttpStatus } from '@nestjs/common';
import type { Workbook, Worksheet } from 'exceljs';
import { AppException } from '../../../common/errors/app.exception.js';
import { type CellData, plainText, readCell } from './excel-cell.js';

/** The header row is looked for in the first rows, in case the export has a title line. */
const HEADER_SEARCH_ROWS = 10;

const COLUMNS = Object.keys(HAR_GAL_HEADERS) as HarGalColumn[];

/** One data row: its Excel row number and the visible value of each of the 10 columns. */
export interface SheetRow {
  rowNumber: number;
  cells: Record<HarGalColumn, CellData>;
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

/**
 * Each of the 10 columns → its column number, by exact header text (trimmed), in any order.
 * Other columns are ignored. A missing header → 400 IMPORT_MISSING_COLUMNS, one of the 10 twice →
 * 400 IMPORT_DUPLICATE_COLUMN; both name the headers in `details.columns`.
 */
function mapColumns(sheet: Worksheet, headerRow: number | null): Record<HarGalColumn, number> {
  const found = new Map<HarGalColumn, number[]>();
  if (headerRow !== null) {
    for (let column = 1; column <= sheet.getRow(headerRow).cellCount; column++) {
      const text = headerText(sheet, headerRow, column);
      const key = COLUMNS.find((name) => HAR_GAL_HEADERS[name] === text);
      if (key) found.set(key, [...(found.get(key) ?? []), column]);
    }
  }
  const headersOf = (keys: HarGalColumn[]) => keys.map((key) => HAR_GAL_HEADERS[key]);
  const missing = COLUMNS.filter((key) => !found.has(key));
  if (missing.length > 0) throw fileError('IMPORT_MISSING_COLUMNS', headersOf(missing));
  const twice = COLUMNS.filter((key) => (found.get(key)?.length ?? 0) > 1);
  if (twice.length > 0) throw fileError('IMPORT_DUPLICATE_COLUMN', headersOf(twice));
  return Object.fromEntries(COLUMNS.map((key) => [key, found.get(key)?.[0] ?? 0])) as Record<
    HarGalColumn,
    number
  >;
}

/**
 * Reads the Har Gal export: the first worksheet, the header row, then every row below it. A row
 * whose 10 columns are all empty is skipped (not counted, not an error). More than
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
      COLUMNS.map((key) => [key, readCell(row.getCell(columns[key]).value)]),
    ) as Record<HarGalColumn, CellData>;
    if (Object.values(cells).every((cell) => cell === null)) return;
    if (rows.length === IMPORT_MAX_ROWS) {
      throw new AppException('IMPORT_TOO_MANY_ROWS', HttpStatus.BAD_REQUEST, {
        maxRows: IMPORT_MAX_ROWS,
      });
    }
    rows.push({ rowNumber, cells });
  });
  if (rows.length === 0) throw new AppException('IMPORT_NO_ROWS', HttpStatus.BAD_REQUEST);
  return rows;
}
