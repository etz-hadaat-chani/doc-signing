import { HAR_GAL_HEADERS, type HarGalColumn } from '@doc-signing/shared';
import ExcelJS, { type CellValue } from 'exceljs';

/**
 * Builds a fake Har Gal employee export (.xlsx) in memory, for tests and the sample script.
 * Made-up data only; never the real export. The 10 columns the import reads are in a shuffled
 * order, mixed with columns it must ignore.
 */
export const FIXTURE_HEADERS: readonly string[] = [
  'שם משפחה',
  'תאריך לידה', // ignored
  'מספר עובד',
  'מחלקה',
  'שם פרטי',
  'E-Mail',
  'מעמד', // ignored
  'תעודת זהות',
  'נייד פרטי - קידומת',
  'נייד פרטי - מספר',
  'קידומת',
  'טלפון',
  'הערות', // ignored
];

/** One employee row: a value per column the import reads; anything left out stays empty. */
export type FixtureRow = Partial<Record<HarGalColumn, CellValue>>;

const COLUMN_BY_HEADER = new Map<string, HarGalColumn>(
  (Object.entries(HAR_GAL_HEADERS) as [HarGalColumn, string][]).map(([key, text]) => [text, key]),
);

/** Values for the ignored columns, so they are not empty (and would fail checks if read). */
const IGNORED_VALUES: Record<string, CellValue> = {
  'תאריך לידה': new Date('1990-05-01T00:00:00Z'),
  מעמד: 'פעיל',
  הערות: '=1+1 not a real formula, just text',
};

export interface WorkbookOptions {
  /** Header texts in order; default FIXTURE_HEADERS. */
  headers?: readonly string[];
  /** Lines above the header row (e.g. a report title). */
  titleRows?: string[];
}

/** `null` in `rows` writes an empty line (the import skips it). */
export async function harGalXlsx(
  rows: (FixtureRow | null)[],
  { headers = FIXTURE_HEADERS, titleRows = [] }: WorkbookOptions = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('עובדים');
  for (const title of titleRows) sheet.addRow([title]);
  sheet.addRow([...headers]);
  for (const row of rows) {
    if (row === null) {
      sheet.addRow([]);
      continue;
    }
    sheet.addRow(
      headers.map((header) => {
        const key = COLUMN_BY_HEADER.get(header);
        return key ? (row[key] ?? null) : (IGNORED_VALUES[header] ?? 'x');
      }),
    );
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Loads bytes back into a workbook (for unit tests of the sheet reader). */
export async function loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return workbook;
}
