// Development seed data (task 1.5). Fake people only.
// ID numbers are hard-coded with a correct check digit; some start with 0.
// Names mix Hebrew, numbers and hyphens on purpose, for the PDF tests (NFR-HEB-3).

import type { UserRole } from '../src/generated/prisma/client.js';

export const seedUsers: { fullName: string; email: string; role: UserRole }[] = [
  { fullName: 'מנהלת מערכת', email: 'manager@doc-signing.local', role: 'manager' },
  { fullName: 'ממונה צפייה', email: 'officer@doc-signing.local', role: 'officer' },
];

export const seedDepartments = ['משאבי אנוש', 'כספים', 'תפעול'] as const;

type SeedDepartment = (typeof seedDepartments)[number];

export const seedEmployees: {
  employeeNumber: string;
  idNumber: string;
  firstName: string;
  lastName: string;
  department: SeedDepartment;
  email: string | null; // null = no email (email_status missing)
}[] = [
  {
    employeeNumber: '1001',
    idNumber: '012345674',
    firstName: 'משה',
    lastName: 'כהן',
    department: 'משאבי אנוש',
    email: 'e1001@example.com',
  },
  {
    employeeNumber: '1002',
    idNumber: '023456783',
    firstName: 'שרה',
    lastName: 'כהן-לוי 2',
    department: 'משאבי אנוש',
    email: 'e1002@example.com',
  },
  {
    employeeNumber: '1003',
    idNumber: '034567891',
    firstName: 'אברהם-חיים',
    lastName: 'פרידמן',
    department: 'משאבי אנוש',
    email: 'e1003@example.com',
  },
  {
    employeeNumber: '1004',
    idNumber: '045678919',
    firstName: 'רבקה',
    lastName: 'בן-דוד 3',
    department: 'משאבי אנוש',
    email: 'e1004@example.com',
  },
  {
    employeeNumber: '1005',
    idNumber: '312345671',
    firstName: 'יעקב',
    lastName: 'גולדשטיין',
    department: 'משאבי אנוש',
    email: 'e1005@example.com',
  },
  {
    employeeNumber: '1006',
    idNumber: '203456785',
    firstName: 'רחל',
    lastName: 'וייס',
    department: 'משאבי אנוש',
    email: 'e1006@example.com',
  },
  {
    employeeNumber: '1007',
    idNumber: '314159260',
    firstName: 'יוסף 2',
    lastName: 'שפירא',
    department: 'משאבי אנוש',
    email: null,
  },
  {
    employeeNumber: '1008',
    idNumber: '271828188',
    firstName: 'לאה',
    lastName: 'רוזנברג',
    department: 'כספים',
    email: 'e1008@example.com',
  },
  {
    employeeNumber: '1009',
    idNumber: '300012341',
    firstName: 'דוד',
    lastName: 'הלוי-כץ',
    department: 'כספים',
    email: 'e1009@example.com',
  },
  {
    employeeNumber: '1010',
    idNumber: '212121214',
    firstName: 'מרים',
    lastName: 'פישר',
    department: 'כספים',
    email: 'e1010@example.com',
  },
  {
    employeeNumber: '1011',
    idNumber: '323232322',
    firstName: 'שמואל-אליהו',
    lastName: 'ברגר',
    department: 'כספים',
    email: 'e1011@example.com',
  },
  {
    employeeNumber: '1012',
    idNumber: '234567899',
    firstName: 'חנה',
    lastName: 'קליין 4',
    department: 'כספים',
    email: 'e1012@example.com',
  },
  {
    employeeNumber: '1013',
    idNumber: '345678908',
    firstName: 'יצחק',
    lastName: 'שוורץ',
    department: 'כספים',
    email: 'e1013@example.com',
  },
  {
    employeeNumber: '1014',
    idNumber: '256789017',
    firstName: 'אסתר',
    lastName: 'לנדאו',
    department: 'תפעול',
    email: 'e1014@example.com',
  },
  {
    employeeNumber: '1015',
    idNumber: '367890126',
    firstName: 'נחום',
    lastName: 'בלום-הורוביץ',
    department: 'תפעול',
    email: null,
  },
  {
    employeeNumber: '1016',
    idNumber: '278901236',
    firstName: 'דבורה',
    lastName: 'אדלר',
    department: 'תפעול',
    email: 'e1016@example.com',
  },
  {
    employeeNumber: '1017',
    idNumber: '389012345',
    firstName: 'מנחם 3',
    lastName: 'גרינברג',
    department: 'תפעול',
    email: 'e1017@example.com',
  },
  {
    employeeNumber: '1018',
    idNumber: '290123454',
    firstName: 'פנינה',
    lastName: 'זילבר',
    department: 'תפעול',
    email: 'e1018@example.com',
  },
  {
    employeeNumber: '1019',
    idNumber: '301234563',
    firstName: 'אהרן',
    lastName: 'טננבאום',
    department: 'תפעול',
    email: 'e1019@example.com',
  },
  {
    employeeNumber: '1020',
    idNumber: '222333445',
    firstName: 'יהודית',
    lastName: 'בר-און 5',
    department: 'תפעול',
    email: 'e1020@example.com',
  },
];

/** Default settings (FR-ADM-2). The app has the same built-in defaults for missing keys (task 3.18). */
export const seedSettings: { key: string; value: number | string | null }[] = [
  { key: 'reminder_interval_days', value: 3 },
  { key: 'max_reminders', value: null }, // null = no limit
  { key: 'link_expiry_days', value: 60 },
  { key: 'sender_name', value: 'מערכת חתימות' },
];
