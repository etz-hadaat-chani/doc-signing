import { z } from 'zod';
import { emailStatusSchema } from './enums.js';

/**
 * The Har Gal export columns the import reads (PRD FR-EMP-1), found by these exact header texts
 * in any order. Every other column is ignored; a missing one fails the whole file.
 */
export const HAR_GAL_HEADERS = {
  employeeNumber: 'מספר עובד',
  idNumber: 'תעודת זהות',
  firstName: 'שם פרטי',
  lastName: 'שם משפחה',
  department: 'מחלקה',
  email: 'E-Mail',
  phonePrefix: 'קידומת',
  phone: 'טלפון',
  mobilePrefix: 'נייד פרטי - קידומת',
  mobile: 'נייד פרטי - מספר',
} as const;
export type HarGalColumn = keyof typeof HAR_GAL_HEADERS;

/** Upload limits (NFR-SEC-9). ~1,500 employees fit in well under 1 MB. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

function rowList(rows: readonly number[]): string {
  return rows.join(', ');
}

/**
 * Why a row can't be imported (error) or what the import will do differently from the file
 * (warning), in Hebrew. Messages never repeat an ID number, email or phone (privacy): the row
 * number and employee number are enough to find the line in Har Gal.
 */
export const IMPORT_ISSUE_MESSAGES = {
  // Errors: the row is not imported.
  EMPLOYEE_NUMBER_MISSING: () => 'חסר מספר עובד',
  EMPLOYEE_NUMBER_INVALID: () => 'מספר העובד חייב להכיל ספרות בלבד (עד 20 ספרות)',
  ID_NUMBER_MISSING: () => 'חסר מספר תעודת זהות',
  ID_NUMBER_INVALID: () => 'מספר תעודת הזהות אינו תקין (ספרת ביקורת או מבנה)',
  FIRST_NAME_MISSING: () => 'חסר שם פרטי',
  FIRST_NAME_TOO_LONG: () => 'השם הפרטי ארוך מ-50 תווים',
  LAST_NAME_MISSING: () => 'חסר שם משפחה',
  LAST_NAME_TOO_LONG: () => 'שם המשפחה ארוך מ-50 תווים',
  DEPARTMENT_MISSING: () => 'חסרה מחלקה',
  DEPARTMENT_INVALID: () => 'המחלקה אינה במבנה "קוד - שם" (למשל "15 - שם המחלקה")',
  EMAIL_TOO_LONG: () => 'כתובת האימייל ארוכה מ-255 תווים',
  DUPLICATE_EMPLOYEE_NUMBER: (otherRows: readonly number[]) =>
    `מספר העובד מופיע בקובץ גם בשורות ${rowList(otherRows)}`,
  DUPLICATE_ID_NUMBER: (otherRows: readonly number[]) =>
    `אותו מספר תעודת זהות מופיע בקובץ גם בשורות ${rowList(otherRows)}`,
  DEPARTMENT_NAME_CONFLICT: (code: number, names: readonly string[]) =>
    `מחלקה ${code} מופיעה בקובץ בכמה שמות: ${names.map((name) => `"${name}"`).join(', ')}`,
  ID_NUMBER_TAKEN: (ownerEmployeeNumber: string) =>
    `מספר תעודת הזהות כבר רשום לעובד אחר (מספר עובד ${ownerEmployeeNumber})`,
  // Warnings: the row is imported anyway.
  EMAIL_INVALID: () => 'כתובת האימייל אינה תקינה. העובד יישמר עם סטטוס "אימייל לא תקין"',
  PHONE_INVALID: () => 'מספר הטלפון אינו תקין. הטלפון יישמר ריק',
} as const;

export type ImportIssueCode = keyof typeof IMPORT_ISSUE_MESSAGES;
export const IMPORT_ISSUE_CODES = Object.keys(IMPORT_ISSUE_MESSAGES) as ImportIssueCode[];

type IssueArgs<C extends ImportIssueCode> = Parameters<(typeof IMPORT_ISSUE_MESSAGES)[C]>;

/** The code and its Hebrew message, e.g. `importIssue('DUPLICATE_ID_NUMBER', [7, 12])`. */
export function importIssue<C extends ImportIssueCode>(
  code: C,
  ...args: IssueArgs<C>
): { code: C; message: string } {
  const build = IMPORT_ISSUE_MESSAGES[code] as (...values: IssueArgs<C>) => string;
  return { code, message: build(...args) };
}

/**
 * One reason about one row: the Excel row number (as HR sees it in Excel) and the employee
 * number when it could be read. Stored as is in `import_batches.errors`. No ID number.
 */
export const importRowIssueSchema = z.object({
  row: z.number().int().positive(),
  employeeNumber: z.string().nullable(),
  code: z.enum(IMPORT_ISSUE_CODES as [ImportIssueCode, ...ImportIssueCode[]]),
  message: z.string(),
});
export type ImportRowIssue = z.infer<typeof importRowIssueSchema>;

/**
 * `POST /api/employees/import/preview`: what the import would do (PRD FR-EMP-2). Every non-empty
 * row is exactly one of new / updated / unchanged / failed. `errors` and `warnings` hold one
 * entry per reason, so a row can appear more than once. No ID numbers anywhere: an ID change
 * shows only as "idNumber: changed".
 */
export const importPreviewSchema = z.object({
  batchId: z.uuid(),
  fileName: z.string(),
  counts: z.object({
    rowsTotal: z.number().int(),
    rowsNew: z.number().int(),
    rowsUpdated: z.number().int(),
    rowsUnchanged: z.number().int(),
    rowsFailed: z.number().int(),
    departmentsNew: z.number().int(),
    departmentsRenamed: z.number().int(),
  }),
  newEmployees: z.array(
    z.object({
      row: z.number().int(),
      employeeNumber: z.string(),
      fullName: z.string(),
      /** "15 - name", as in the file. */
      department: z.string(),
      emailStatus: emailStatusSchema,
    }),
  ),
  updatedEmployees: z.array(
    z.object({
      row: z.number().int(),
      employeeNumber: z.string(),
      fullName: z.string(),
      /** "field: old → new", one per changed field. */
      changes: z.array(z.string()),
    }),
  ),
  newDepartments: z.array(z.object({ code: z.number().int(), name: z.string() })),
  renamedDepartments: z.array(
    z.object({ code: z.number().int(), from: z.string(), to: z.string() }),
  ),
  errors: z.array(importRowIssueSchema),
  warnings: z.array(importRowIssueSchema),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;
