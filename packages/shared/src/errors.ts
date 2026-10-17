import { z } from 'zod';

/**
 * Every API error code and its Hebrew message. The code is stable English (the web app and
 * tests match on it); the message is what the user reads. Zod schemas in this package use the
 * code as their issue message (e.g. idNumberSchema → INVALID_ID_NUMBER), so a field error maps
 * straight to a Hebrew message.
 */
export const ERROR_MESSAGES = {
  VALIDATION_FAILED: 'חלק מהנתונים שנשלחו אינם תקינים',
  INVALID_VALUE: 'הערך אינו תקין',
  INVALID_ID_NUMBER: 'מספר תעודת הזהות אינו תקין',
  INVALID_EMPLOYEE_NUMBER: 'מספר העובד חייב להכיל ספרות בלבד (עד 20 ספרות)',
  INVALID_PHONE: 'מספר הטלפון אינו תקין',
  INVALID_BIRTH_DATE: 'תאריך הלידה אינו תקין (תאריך עתידי או לפני 1900)',
  BAD_REQUEST: 'הבקשה אינה תקינה',
  INVALID_CREDENTIALS: 'האימייל או הסיסמה שגויים',
  UNAUTHORIZED: 'יש להתחבר למערכת',
  FORBIDDEN: 'אין לך הרשאה לבצע פעולה זו',
  NOT_FOUND: 'הפריט המבוקש לא נמצא',
  CONFLICT: 'קיים כבר פריט עם אותם פרטים',
  EMAIL_TAKEN: 'כתובת האימייל כבר רשומה במערכת',
  CANNOT_CHANGE_OWN_ACCESS: 'לא ניתן להשבית את המשתמש שלך או להסיר ממנו את הרשאת המנהל',
  LAST_ACTIVE_MANAGER: 'חייב להישאר לפחות מנהל פעיל אחד במערכת',
  EMPLOYEE_NUMBER_TAKEN: 'מספר העובד כבר קיים במערכת',
  ID_NUMBER_TAKEN: 'מספר תעודת הזהות כבר רשום לעובד אחר',
  DEPARTMENT_NOT_FOUND: 'המחלקה לא נמצאה',
  RELATED_RECORD_CONFLICT: 'לא ניתן לבצע את הפעולה בגלל נתונים קשורים',
  FILE_REQUIRED: 'יש לצרף קובץ אחד',
  FILE_TOO_LARGE: 'הקובץ גדול מדי',
  INVALID_EXCEL_FILE: 'הקובץ אינו קובץ Excel תקין (xlsx). אם הקובץ מוגן בסיסמה, יש להסיר את הסיסמה',
  IMPORT_MISSING_COLUMNS: 'חסרות בקובץ עמודות חובה',
  IMPORT_DUPLICATE_COLUMN: 'אותה כותרת עמודה מופיעה בקובץ יותר מפעם אחת',
  IMPORT_TOO_MANY_ROWS: 'יש בקובץ יותר מדי שורות',
  IMPORT_NO_ROWS: 'אין בקובץ שורות עובדים',
  IMPORT_ALREADY_DONE: 'הייבוא הזה כבר אושר או שאינו בתוקף עוד. יש להעלות את הקובץ שוב',
  IMPORT_STALE: 'הנתונים השתנו מאז התצוגה המקדימה. יש להעלות את הקובץ שוב',
  IMPORT_FILE_MISSING: 'קובץ הייבוא לא נמצא באחסון. יש להעלות את הקובץ שוב',
  IMPORT_EXPIRED: 'התצוגה המקדימה ישנה מדי (יותר מ-24 שעות). יש להעלות את הקובץ שוב',
  INVALID_PDF_FILE: 'הקובץ אינו קובץ PDF תקין. יש לשמור אותו מחדש בעזרת "הדפסה ל-PDF" ולהעלות שוב',
  PDF_ENCRYPTED: 'קובץ ה-PDF מוגן בסיסמה או מוצפן. יש לשמור אותו מחדש ללא הגנה ולהעלות שוב',
  PDF_ACTIVE_CONTENT:
    'קובץ ה-PDF מכיל קוד או תוכן פעיל (למשל JavaScript או קבצים מצורפים). יש לשמור אותו מחדש בעזרת "הדפסה ל-PDF" ולהעלות שוב',
  PDF_FORM_FIELDS:
    'קובץ ה-PDF מכיל שדות למילוי. יש לשמור אותו מחדש בעזרת "הדפסה ל-PDF" ולהעלות שוב',
  PDF_ROTATED_PAGES:
    'בקובץ ה-PDF יש עמודים מסובבים. יש לשמור אותו מחדש בעזרת "הדפסה ל-PDF" ולהעלות שוב',
  PDF_TOO_MANY_PAGES: 'בקובץ ה-PDF יש יותר מדי עמודים (עד 50 עמודים)',
  TEMPLATE_FIELD_TYPE_NOT_SUPPORTED:
    'סוג השדה עדיין אינו נתמך. אפשר להשתמש בשם מלא, מספר זהות, תאריך וחתימה',
  TEMPLATE_FIELD_OUTSIDE_PAGE: 'מיקום של שדה חורג מגבולות העמוד או מפנה לעמוד שאינו קיים',
  TEMPLATE_ARCHIVED: 'התבנית הועברה לארכיון ולא ניתן לשנות אותה',
  TEMPLATE_HAS_NEWER_VERSION:
    'קיימת גרסה חדשה יותר של התבנית. יש לרענן את הדף ולערוך את הגרסה האחרונה',
  PAYLOAD_TOO_LARGE: 'הקובץ או הבקשה גדולים מדי',
  LOCKED: 'הגישה נחסמה. יש לפנות למשאבי אנוש',
  TOO_MANY_REQUESTS: 'יותר מדי ניסיונות. נא לנסות שוב מאוחר יותר',
  INTERNAL_ERROR: 'אירעה שגיאה בלתי צפויה. נא לנסות שוב מאוחר יותר',
  SERVICE_UNAVAILABLE: 'השירות אינו זמין כרגע. נא לנסות שוב מאוחר יותר',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const ERROR_CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value);
}

export function errorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

/** One invalid field in a VALIDATION_FAILED error. Never carries the value that was sent. */
export const fieldErrorSchema = z.object({
  field: z.string(),
  code: z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/** The body of every API error response. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
