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
    employeeNew: 'הוספת עובד',
    employeeEdit: 'עריכת עובד',
    employeeImport: 'ייבוא מאקסל',
    manual: 'טיפול ידני',
    approvals: 'ממתינים לאישור',
    templates: 'תבניות',
    settings: 'הגדרות',
    users: 'משתמשי מערכת',
    componentsDemo: 'רכיבים משותפים (הדגמה)',
  },

  common: {
    cancel: 'ביטול',
    close: 'סגירה',
    working: 'מבצע…',
  },

  table: {
    empty: 'אין נתונים להצגה.',
    rowsPerPage: 'שורות בעמוד:',
    displayedRows: (from: number, to: number, total: number) => `${from}–${to} מתוך ${total}`,
    firstPage: 'עמוד ראשון',
    previousPage: 'העמוד הקודם',
    nextPage: 'העמוד הבא',
    lastPage: 'עמוד אחרון',
    selectRow: 'בחירת השורה',
    selectAllOnPage: 'בחירת כל השורות בעמוד',
    selectedCount: (count: number) => (count === 1 ? 'נבחרה שורה אחת' : `נבחרו ${count} שורות`),
  },

  filters: {
    label: 'סינון',
    all: 'הכול',
    status: 'סטטוס',
    department: 'מחלקה',
    search: 'חיפוש',
    searchHint: 'שם, מספר עובד או תעודת זהות',
  },

  upload: {
    choose: 'בחירת קובץ',
    dropHere: 'אפשר לגרור לכאן קובץ',
    allowed: (types: string, max: string) => `קבצים מסוג ${types}, עד ${max}`,
    wrongType: (types: string) => `סוג הקובץ אינו נתמך. אפשר להעלות רק ${types}.`,
    tooLarge: (max: string) => `הקובץ גדול מדי. הגודל המרבי הוא ${max}.`,
    tooMany: 'אפשר להעלות קובץ אחד בלבד.',
    empty: 'הקובץ ריק.',
    remove: 'הסרה',
    chosen: 'הקובץ שנבחר',
    kilobytes: (value: string) => `${value} ק״ב`,
    megabytes: (value: string) => `${value} מ״ב`,
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

  /** The dashboard (A2). Status names come from STATUS_LABELS / ROUND_STATUS_LABELS (shared). */
  dashboard: {
    refresh: 'רענון',
    refreshing: 'מרענן…',
    updatedAt: (time: string) => `עודכן ב-${time}`,
    totalsTitle: 'סיכום הסבבים הפעילים',
    activeRounds: (count: number, formatted: string) =>
      count === 1 ? 'סבב פעיל אחד' : `${formatted} סבבים פעילים`,
    percentSigned: (percent: string) => `${percent}% נחתמו`,
    recipients: (count: number, formatted: string) =>
      count === 1 ? 'נמען אחד' : `${formatted} נמענים`,
    roundsTitle: 'סבבים פעילים',
    noActiveRounds: 'אין סבבים פעילים כרגע.',
    needsHandling: 'דורש טיפול:',
    nothingToHandle: 'אין עובדים שדורשים טיפול.',
    sentProgress: (sent: string, total: string) => `נשלחו ${sent} מתוך ${total}`,
    progressLabel: 'התקדמות השליחה',
    linkExpires: (date: string) => `הקישורים בתוקף עד ${date}`,
    draftsTitle: (formatted: string) => `טיוטות פתוחות (${formatted})`,
    draftsHint: 'טיוטה שלא נשלחה תופסת את העובדים שבה. כדאי לשלוח אותה או לבטל אותה.',
    draftAge: (days: number) =>
      days === 0 ? 'נוצרה היום' : days === 1 ? 'נוצרה אתמול' : `נוצרה לפני ${days} ימים`,
    allDrafts: 'לכל הטיוטות',
    emptyTitle: 'עדיין אין סבבים',
    emptyText: 'מצב החתימות יופיע כאן אחרי שייווצר הסבב הראשון.',
  },

  /**
   * Employees (A6 list, A7 card, add / edit). Email status texts for "no email" come from shared
   * NO_EMAIL_REASONS; status names from STATUS_LABELS.
   */
  employees: {
    listCaption: 'רשימת העובדים',
    add: 'הוספת עובד',
    edit: 'עריכה',
    empty: 'לא נמצאו עובדים.',
    emptyValue: '—',
    active: 'פעיל',
    inactive: 'לא פעיל',
    emailValid: 'מייל תקין',
    emailStatusFilter: 'מצב המייל',
    activeFilter: 'מצב העובד',
    columns: {
      employeeNumber: 'מספר עובד',
      name: 'שם',
      department: 'מחלקה',
      emailStatus: 'מייל',
      active: 'מצב',
    },
    /** Field names on the card and in the form, in the card's order (FR-EMP-7). */
    fields: {
      employeeNumber: 'מספר עובד',
      idNumber: 'תעודת זהות',
      firstName: 'שם פרטי',
      lastName: 'שם משפחה',
      department: 'מחלקה',
      email: 'אימייל',
      landline: 'טלפון',
      mobile: 'טלפון נייד',
      address: 'כתובת',
      city: 'יישוב',
      birthDate: 'תאריך לידה',
      jobTitle: 'תפקיד',
      employmentStatus: 'מעמד',
      jobPercent: 'אחוז משרה',
      workDays: 'ימי עבודה',
      hoursBaseCode: 'בסיס שעות עבודה',
      pensionFundA: 'קופת גמל א',
      pensionFundB: 'קופת גמל ב',
      studyFund: 'קרן השתלמות',
      isActive: 'עובד פעיל',
    },
    card: {
      detailsTitle: 'פרטי העובד',
      employeeNumber: (number: string) => `מספר עובד ${number}`,
      birthDateWithAge: (date: string, age: number) => `${date} (גיל ${age})`,
      jobPercent: (percent: string) => `${percent}%`,
    },
    history: {
      title: 'היסטוריית סבבים',
      round: 'סבב',
      document: 'מסמך',
      department: 'מחלקה בעת השליחה',
      status: 'סטטוס',
      sentAt: 'נשלח',
      signedAt: 'נחתם',
      file: 'מסמך חתום',
      openDocument: 'צפייה במסמך',
      empty: 'העובד עדיין לא נכלל באף סבב.',
      documentVersion: (name: string, version: number) => `${name} (גרסה ${version})`,
    },
    form: {
      addTitle: 'הוספת עובד',
      editTitle: (name: string) => `עריכת עובד: ${name}`,
      harGalReminder: 'הייבוא הבא מהר גל ידרוס את מה שמוקלד כאן. יש לתקן גם בהר גל.',
      mainSection: 'פרטים בסיסיים',
      contactSection: 'פרטי קשר',
      jobSection: 'פרטי העסקה',
      save: 'שמירה',
      saving: 'שומר…',
      created: 'העובד נוסף',
      saved: 'פרטי העובד נשמרו',
      noChanges: 'לא בוצעו שינויים',
      fixFields: 'יש לתקן את השדות המסומנים.',
      required: 'שדה חובה',
      tooLong: (max: number) => `עד ${max} תווים`,
      chooseDepartment: 'יש לבחור מחלקה',
      dateFormat: 'DD/MM/YYYY',
      dateInvalid: 'יש להקליד תאריך בצורה DD/MM/YYYY',
      jobPercentInvalid: 'יש להקליד מספר בין 0 ל-100',
      hoursBaseCodeInvalid: 'יש להקליד מספר שלם (הקוד מהר גל)',
      hoursBase: (label: string) => `בסיס: ${label}`,
      employeeNumberLocked: 'אי אפשר לשנות מספר עובד',
      inactiveHint: 'עובד לא פעיל לא ייכלל בסבבים חדשים.',
    },
  },

  /** The components demo page (4.2, development only). Every name and number there is made up. */
  demo: {
    intro: 'דף לבדיקת הרכיבים המשותפים. כל הנתונים כאן מומצאים. הדף קיים רק בסביבת הפיתוח.',
    chipsTitle: 'תגיות סטטוס',
    assignmentChips: 'סטטוס של עובד בסבב',
    roundChips: 'סטטוס של סבב',
    tableTitle: 'טבלה עם סינון ודפדוף',
    tableCaption: 'עובדים לדוגמה',
    tableHint:
      'הסטטוס, המחלקה והעמוד נשמרים בכתובת. טקסט החיפוש נשמר רק בזיכרון ואינו מופיע בכתובת.',
    columnName: 'שם',
    columnEmployeeNumber: 'מספר עובד',
    columnDepartment: 'מחלקה',
    columnStatus: 'סטטוס',
    employeeName: (number: number) => `עובד/ת לדוגמה ${number}`,
    departmentName: (letter: string) => `מחלקה לדוגמה ${letter}`,
    modeLabel: 'מצב הטבלה',
    modeNormal: 'נתונים',
    modeError: 'שגיאה',
    modeEmpty: 'ללא תוצאות',
    sendSelected: 'שליחה לנבחרים',
    sentToSelected: (count: number) =>
      count === 1 ? 'נשלח לעובד אחד (הדגמה)' : `נשלח ל-${count} עובדים (הדגמה)`,
    dialogsTitle: 'חלון אישור',
    openNormal: 'אישור רגיל',
    openDanger: 'אישור פעולה מסוכנת',
    normalTitle: 'שליחת תזכורת',
    normalText: 'תישלח תזכורת לכל מי שעדיין לא חתם.',
    normalConfirm: 'שליחה',
    dangerTitle: 'ביטול הסבב',
    dangerText: 'כל הקישורים של הסבב יפסיקו לעבוד. אי אפשר לבטל את הפעולה.',
    dangerConfirm: 'ביטול הסבב',
    noteLabel: 'הערה (לא חובה)',
    confirmed: 'הפעולה בוצעה (הדגמה)',
    uploadTitle: 'העלאת קובץ',
    excelUpload: 'קובץ עובדים מהר גל',
    excelTypes: 'Excel (.xlsx)',
    imageUpload: 'תמונת חתימת המעסיק',
    imageTypes: 'PNG',
    notificationsTitle: 'הודעות',
    showSuccess: 'הודעת הצלחה',
    showError: 'הודעת שגיאה',
    successText: 'ההגדרות נשמרו (הדגמה)',
    errorText: 'השמירה נכשלה. נא לנסות שוב. (הדגמה)',
  },

  placeholder: {
    text: (task: string) => `המסך הזה ייבנה במשימה ${task}.`,
  },

  sign: {
    placeholderTitle: 'חתימה על מסמך',
    placeholderText: 'דף החתימה עדיין בבנייה.',
  },
} as const;
