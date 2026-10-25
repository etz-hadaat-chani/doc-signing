import type { UserRole } from '@doc-signing/shared';

/**
 * Every Hebrew text of the web app. Components never hold inline strings. API error texts are
 * not repeated here: they come from ERROR_MESSAGES in @doc-signing/shared, by error code.
 */
export const he = {
  app: {
    organization: 'עץ הדעת',
    systemName: 'מערכת חתימות',
  },

  /** Role labels, in one place so a rename is one line. */
  roles: {
    manager: 'מנהל',
    officer: 'קצין',
  } satisfies Record<UserRole, string>,

  nav: {
    label: 'תפריט ראשי',
    dashboard: 'לוח בקרה',
    rounds: 'סבבי שליחה',
    roundDetails: 'פרטי סבב',
    newRound: 'סבב חדש',
    employees: 'עובדים',
    employeeCard: 'כרטיס עובד',
    employeeImport: 'ייבוא מאקסל',
    manual: 'טיפול ידני',
    approvals: 'ממתינים לאישור',
    templates: 'תבניות',
    settings: 'הגדרות',
    users: 'משתמשי מערכת',
  },

  topBar: {
    logout: 'יציאה',
    signedInAs: 'מחובר/ת כ',
  },

  login: {
    title: 'כניסה',
    email: 'אימייל',
    password: 'סיסמה',
    submit: 'כניסה',
    submitting: 'נכנסים…',
    emailRequired: 'יש להזין אימייל',
    emailInvalid: 'כתובת האימייל אינה תקינה',
    passwordRequired: 'יש להזין סיסמה',
    retryInMinutes: (minutes: number) =>
      minutes <= 1 ? 'אפשר לנסות שוב בעוד דקה' : `אפשר לנסות שוב בעוד ${minutes} דקות`,
  },

  feedback: {
    loading: 'טוען…',
    retry: 'נסה שוב',
    backToDashboard: 'חזרה ללוח הבקרה',
    noPermissionTitle: 'אין לך הרשאה',
    noPermissionText: 'אין לך הרשאה לצפות במסך הזה. אם נראה לך שזו טעות, יש לפנות למנהל המערכת.',
    notFoundTitle: 'הדף לא נמצא',
    notFoundText: 'הכתובת שהוקלדה אינה קיימת במערכת.',
    serverErrorTitle: 'אירעה שגיאה',
    networkTitle: 'אין חיבור לשרת',
    networkText: 'אין חיבור לשרת. נא לבדוק את החיבור לאינטרנט ולנסות שוב.',
    unexpectedText:
      'התקבלה תשובה לא צפויה מהשרת. ייתכן שהבקשה נחסמה בסינון האינטרנט. נא לנסות שוב מאוחר יותר.',
    crashTitle: 'משהו השתבש',
    crashText: 'אירעה שגיאה בהצגת המסך. נא לרענן את הדף.',
    referenceId: (id: string) => `מספר אסמכתא: ${id}`,
    offline: 'אין חיבור לאינטרנט. הנתונים יתעדכנו כשהחיבור יחזור.',
  },

  placeholder: {
    text: (task: string) => `המסך הזה ייבנה במשימה ${task}.`,
  },

  sign: {
    placeholderTitle: 'חתימה על מסמך',
    placeholderText: 'דף החתימה עדיין בבנייה.',
  },
} as const;
