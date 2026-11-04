import ExcelJS from 'exceljs';

// Shared by the import e2e files (5.3, 7.1): Excel files in the Har Gal layout, built in memory.

// The Har Gal headers the import reads (shared HAR_GAL_HEADERS), one optional extra column
// (יישוב) and one column the import must ignore.
export const HEADERS = [
  'שם משפחה',
  'שכר בסיס',
  'מספר עובד',
  'מחלקה',
  'שם פרטי',
  'E-Mail',
  'תעודת זהות',
  'נייד פרטי - קידומת',
  'נייד פרטי - מספר',
  'קידומת',
  'טלפון',
  'יישוב',
] as const;
export type Header = (typeof HEADERS)[number];
export type FakeRow = Partial<Record<Header, string | number>>;

export async function harGalFile(rows: FakeRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('עובדים');
  sheet.addRow([...HEADERS]);
  for (const row of rows) sheet.addRow(HEADERS.map((header) => row[header] ?? null));
  return {
    name: 'בדיקה אוטומטית.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}
