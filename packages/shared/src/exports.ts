import { z } from 'zod';
import type { SignMethod } from './enums.js';
import { optionalQuery } from './pagination.js';
import { assignmentFiltersShape } from './tracking.js';

/**
 * Exports and file access (3.17, FR-TRK-3, FR-TRK-4): the status export to Excel, the ZIP of
 * signed files and the signed-document link. Filters in the address carry no personal data:
 * never search text (it may be an ID number).
 */

/** `GET /api/rounds/:id/export`: the employee table's filters, without paging or `q`. */
export const roundExportQuerySchema = z.strictObject(assignmentFiltersShape);
export type RoundExportQuery = z.output<typeof roundExportQuerySchema>;

/** `GET /api/rounds/:id/download?dept=`: one department at send time, or all. */
export const roundDownloadQuerySchema = z.strictObject({ dept: optionalQuery(z.uuid()) });
export type RoundDownloadQuery = z.output<typeof roundDownloadQuerySchema>;

/** How a document was signed, as the export shows it. */
export const SIGN_METHOD_LABELS: Readonly<Record<SignMethod, string>> = {
  digital: 'דיגיטלית',
  manual: 'סריקה ידנית',
  kiosk: 'עמדה במשרד',
};

/** The export's approval column (FR-TRK-6). */
export const APPROVAL_LABELS = {
  waiting: 'ממתין לאישור',
  approved: 'אושר',
  returned: 'הוחזר לתיקון',
} as const;

/** A box filled from a system value shows this, never the value (FR-TRK-4, NFR-PRV-6). */
export const FILLED_BY_EMPLOYEE_LABEL = 'מולא ע"י העובד';
/** A drawing answer in the export. */
export const DRAWING_ANSWER_LABEL = 'צויר';
export const YES_LABEL = 'כן';
export const NO_LABEL = 'לא';

/** The export's fixed columns, in order; the answer columns follow (header = box label). */
export const EXPORT_COLUMNS = [
  { key: 'employeeNumber', header: 'מספר עובד', width: 12 },
  { key: 'firstName', header: 'שם פרטי', width: 14 },
  { key: 'lastName', header: 'שם משפחה', width: 16 },
  { key: 'department', header: 'מחלקה', width: 28 },
  { key: 'document', header: 'מסמך', width: 28 },
  { key: 'status', header: 'סטטוס', width: 18 },
  { key: 'sentAt', header: 'נשלח', width: 12 },
  { key: 'openedAt', header: 'נפתח', width: 12 },
  { key: 'signedAt', header: 'נחתם', width: 12 },
  { key: 'lastUpdateAt', header: 'עדכון אחרון', width: 12 },
  { key: 'reminderCount', header: 'תזכורות שנשלחו', width: 10 },
  { key: 'lastReminderAt', header: 'תזכורת אחרונה', width: 12 },
  { key: 'signMethod', header: 'אופן חתימה', width: 14 },
  { key: 'handledBy', header: 'טופל ע"י', width: 18 },
  { key: 'emailChoice', header: 'קבלת עותק', width: 10 },
  { key: 'emailGiven', header: 'מייל שנמסר', width: 26 },
  { key: 'emailDiffers', header: 'שונה מהמייל במערכת', width: 12 },
  { key: 'approval', header: 'אישור', width: 14 },
  { key: 'correctionRound', header: 'נשלח שוב בסבב', width: 28 },
] as const;
export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]['key'];

/** The download names (the round name is added in front). */
export const EXPORT_FILE_SUFFIX = 'סטטוס';
export const ZIP_FILE_SUFFIX = 'מסמכים חתומים';
/** The note file at the top of the ZIP when signed files were not found in storage. */
export const ZIP_MISSING_NOTE_NAME = 'קבצים חסרים.txt';
export const ZIP_MISSING_NOTE_TITLE =
  'הקבצים של העובדים הבאים לא נמצאו באחסון ולכן אינם בקובץ הזה. יש לפנות לתמיכה:';
