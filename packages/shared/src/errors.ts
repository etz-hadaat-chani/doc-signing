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
  EMPLOYEE_NOT_FOUND: 'העובד לא נמצא',
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
  INVALID_PNG_FILE: 'הקובץ אינו תמונת PNG תקינה. יש לשמור את התמונה מחדש בפורמט PNG ולהעלות שוב',
  PNG_DIMENSIONS_INVALID: 'גודל התמונה אינו מתאים: כל צד חייב להיות בין 100 ל-3000 פיקסלים',
  TEMPLATE_FIELD_FILL_MODE_NOT_ALLOWED: 'האפשרות "מי ממלא" שנבחרה אינה מתאימה לסוג השדה',
  TEMPLATE_FIELD_KEY_NOT_ALLOWED:
    'המפתח של השדה אינו תקין: אותיות אנגליות קטנות, ספרות וקו תחתון (עד 50 תווים). שדות מערכת וחתימות משתמשים בשם הקבוע שלהם',
  TEMPLATE_FIELD_OPTION_NOT_ALLOWED: 'הגדרה זו אינה מתאימה לסוג השדה',
  TEMPLATE_FIELD_LIMIT_INVALID:
    'אחת המגבלות של השדה אינה תקינה (אורך הטקסט, האפשרויות ברשימה או התאריכים)',
  TEMPLATE_FIELD_OUTSIDE_PAGE: 'מיקום של שדה חורג מגבולות העמוד או מפנה לעמוד שאינו קיים',
  TEMPLATE_ARCHIVED: 'התבנית הועברה לארכיון ולא ניתן לשנות אותה',
  TEMPLATE_HAS_NEWER_VERSION:
    'קיימת גרסה חדשה יותר של התבנית. יש לרענן את הדף ולערוך את הגרסה האחרונה',
  TEMPLATE_NOT_FOUND: 'התבנית לא נמצאה',
  ROUND_RECIPIENTS_REQUIRED: 'יש לבחור לפחות נמען אחד: כל העובדים, מחלקות או עובדים',
  ROUND_TEMPLATE_REQUIRED: 'יש לבחור תבנית לסבב',
  ROUND_TEMPLATE_NOT_ALLOWED: 'בסבב לפי מחלקות התבנית נקבעת לכל מחלקה, ולא תבנית אחת לכולם',
  ROUND_DEPARTMENT_TEMPLATES_NOT_ALLOWED: 'בסבב עם תבנית אחת אין לבחור תבנית לכל מחלקה',
  DEPARTMENT_TEMPLATE_DUPLICATE: 'נבחרה יותר מתבנית אחת לאותה מחלקה',
  ROUND_CANNOT_BE_CREATED:
    'לא ניתן ליצור את הסבב עדיין. יש לטפל בבעיות שמופיעות בתצוגה המקדימה ולנסות שוב',
  ROUND_TEMPLATES_CHANGED:
    'אחת התבניות השתנתה בזמן יצירת הסבב. יש לבדוק שוב את התצוגה המקדימה ולנסות מחדש',
  ROUND_NOT_FOUND: 'הסבב לא נמצא',
  ROUND_NOT_DRAFT: 'הסבב כבר נשלח או בוטל. ניתן לשלוח רק סבב בטיוטה',
  ASSIGNMENT_NOT_FOUND: 'השליחה לעובד לא נמצאה',
  ROUND_NOT_SENT: 'הסבב עדיין בטיוטה. יש לשלוח אותו קודם',
  ROUND_NOT_OPEN: 'הסבב סגור או בוטל, ולא ניתן לבצע בו פעולות',
  LINK_EXPIRED: 'תוקף הקישורים בסבב הזה פג',
  ASSIGNMENT_ALREADY_SIGNED: 'המסמך כבר נחתם. אם צריך לתקן אותו, יש להחזיר אותו לתיקון',
  ASSIGNMENT_ALREADY_CANCELLED: 'השליחה לעובד כבר בוטלה',
  ASSIGNMENT_NOT_REMINDABLE: 'ניתן לשלוח תזכורת רק לעובד שקיבל את המסמך ועדיין לא חתם',
  ASSIGNMENT_LOCKED: 'הגישה של העובד נעולה. יש לבטל את הנעילה קודם',
  EMPLOYEE_NO_VALID_EMAIL: 'לעובד אין כתובת מייל תקינה. יש לתקן את הכתובת או לטפל בו ידנית',
  EMAIL_ALREADY_QUEUED: 'מייל לעובד כבר בדרך. נא לנסות שוב בעוד רגע',
  REMIND_TOO_SOON: 'נשלח מייל לעובד לפני פחות משעה. אפשר לשלוח שוב מאוחר יותר',
  ASSIGNMENT_NOT_RESENDABLE:
    'שליחה חוזרת אפשרית רק אחרי שליחה שנכשלה או אחרי תיקון מייל שגוי. לעובד שכבר קיבל את המסמך יש לשלוח תזכורת',
  EMAIL_NOT_CHANGED: 'יש לתקן את כתובת המייל של העובד לפני שליחה חוזרת',
  ASSIGNMENT_NOT_LOCKED: 'הגישה של העובד אינה נעולה',
  UNLOCK_LIMIT_REACHED:
    'הגישה ננעלה שוב אחרי שתי פתיחות. יש לבטל את השליחה לעובד ולטפל בו במשרד: הדפסה או עמדת חתימה במשרד',
  ROUND_TEMPLATE_OUTDATED:
    'לתבנית בסבב יש גרסה חדשה יותר או שהיא הועברה לארכיון. אפשר לשלוח את הגרסה שבסבב, או לבטל את הסבב וליצור סבב חדש',
  ROUND_TEMPLATE_NOT_READY:
    'תבנית בסבב אינה מוכנה לשליחה (למשל חסרה תמונת חתימת המעסיק). יש לטפל בסיבות שמופיעות ולנסות שוב',
  EMPLOYER_SIGNATURE_IMAGE_MISMATCH:
    'תמונת חתימת המעסיק השמורה במסמך אינה תואמת לקובץ באחסון. המסמך לא נוצר; יש לפנות לתמיכה',
  EMPLOYER_SIGNATURE_NOT_SAVED: 'חתימת המעסיק לא נשמרה במסמך. המסמך לא נוצר; יש לפנות לתמיכה',
  SIGNATURE_IMAGE_INVALID: 'לא ניתן לקרוא את החתימה. יש לנקות את משטח החתימה ולחתום שוב',
  SIGNATURE_IMAGE_TOO_LARGE: 'קובץ החתימה גדול מדי. יש לנקות את משטח החתימה ולחתום שוב',
  SIGNATURE_IMAGE_DIMENSIONS_INVALID: 'גודל משטח החתימה אינו מתאים. יש לרענן את הדף ולחתום שוב',
  SIGNATURE_EMPTY: 'לא נמצאה חתימה. יש לחתום עם העכבר בתוך המסגרת',
  INVALID_EMAIL: 'כתובת האימייל אינה תקינה',
  EMAIL_CHOICE_REQUIRED: 'יש לבחור אחת משתי האפשרויות: כתובת אימייל, או "אין לי אימייל"',
  ANSWER_REQUIRED: 'יש למלא שדה זה',
  ANSWER_TOO_LONG: 'הטקסט ארוך מדי',
  ANSWER_NOT_A_CHOICE: 'יש לבחור אחת מהאפשרויות ברשימה',
  ANSWER_DATE_INVALID: 'התאריך אינו תקין',
  ANSWER_DATE_OUT_OF_RANGE: 'התאריך מחוץ לטווח המותר',
  ANSWER_BOX_HIDDEN: 'נשלחה תשובה לשדה שאינו מוצג לפי הבחירות בטופס',
  ANSWER_UNKNOWN_BOX: 'נשלחה תשובה לשדה שאינו קיים במסמך',
  ANSWER_DOES_NOT_FIT: 'הטקסט ארוך מדי למקום שלו במסמך. יש לקצר אותו',
  DRAWING_IMAGE_INVALID: 'לא ניתן לקרוא את הציור. יש לנקות את משטח הציור ולצייר שוב',
  DRAWING_IMAGE_TOO_LARGE: 'קובץ הציור גדול מדי. יש לנקות את משטח הציור ולצייר שוב',
  DRAWING_IMAGE_DIMENSIONS_INVALID: 'גודל משטח הציור אינו מתאים. יש לרענן את הדף ולצייר שוב',
  DRAWING_EMPTY: 'לא נמצא ציור. יש לצייר בתוך המסגרת',
  HR_CONTACT_PHONE_OR_EMAIL: 'יש למלא טלפון או אימייל של משאבי אנוש (או את שניהם)',
  // Employee signing (3.13): read by the employee, so short and plain, with what to do next.
  SIGN_LINK_NOT_FOUND: 'הקישור אינו תקין. יש לפתוח את הקישור מהמייל שקיבלת',
  SIGN_ALREADY_SIGNED: 'המסמך כבר נחתם. אין צורך לחתום שוב',
  SIGN_CANCELLED: 'המסמך בוטל ואינו ממתין לחתימה. לשאלות יש לפנות למשאבי אנוש',
  SIGN_LINK_EXPIRED: 'תוקף הקישור פג. יש לפנות למשאבי אנוש',
  SIGN_LOCKED: 'הגישה למסמך ננעלה אחרי 5 ניסיונות שגויים. יש לפנות למשאבי אנוש',
  SIGN_ID_MISMATCH: 'מספר תעודת הזהות אינו תואם. יש לבדוק ולהקליד שוב',
  SIGN_SESSION_EXPIRED: 'עבר זמן רב מדי. יש להקליד שוב את מספר תעודת הזהות כדי להמשיך',
  SIGN_TOO_MANY_REQUESTS: 'יותר מדי בקשות מהמחשב הזה. נא לנסות שוב בעוד כמה דקות',
  SIGN_ACK_REQUIRED: 'יש לסמן שקראת את המסמך ושהחתימה שלך',
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
