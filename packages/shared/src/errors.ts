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
