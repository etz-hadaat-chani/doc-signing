// Development seed data (task 1.5). Fake people only.
// ID numbers are hard-coded with a correct check digit; some start with 0.
// Names mix Hebrew, numbers and hyphens on purpose, for the PDF tests (NFR-HEB-3).

import { SETTING_DEFAULTS } from '../src/common/settings/settings.defaults.js';
import type { UserRole } from '../src/generated/prisma/client.js';

export const seedUsers: { fullName: string; email: string; role: UserRole }[] = [
  { fullName: 'מנהלת מערכת', email: 'manager@doc-signing.local', role: 'manager' },
  { fullName: 'ממונה צפייה', email: 'officer@doc-signing.local', role: 'officer' },
];

// Codes and names as in the Har Gal export ("15 - ממלאות מקום ירושלים"); code is the identity.
export const seedDepartments = [
  { code: 15, name: 'ממלאות מקום ירושלים' },
  { code: 19, name: 'ממ חינוך מיוחד' },
  { code: 61, name: 'ממלאות מקום אלעד-61' },
] as const;

type SeedDepartmentCode = (typeof seedDepartments)[number]['code'];

export const seedEmployees: {
  employeeNumber: string;
  idNumber: string;
  firstName: string;
  lastName: string;
  departmentCode: SeedDepartmentCode;
  email: string | null; // null = no email (email_status missing)
}[] = [
  {
    employeeNumber: '1001',
    idNumber: '012345674',
    firstName: 'משה',
    lastName: 'כהן',
    departmentCode: 15,
    email: 'e1001@example.com',
  },
  {
    employeeNumber: '1002',
    idNumber: '023456783',
    firstName: 'שרה',
    lastName: 'כהן-לוי 2',
    departmentCode: 15,
    email: 'e1002@example.com',
  },
  {
    employeeNumber: '1003',
    idNumber: '034567891',
    firstName: 'אברהם-חיים',
    lastName: 'פרידמן',
    departmentCode: 15,
    email: 'e1003@example.com',
  },
  {
    employeeNumber: '1004',
    idNumber: '045678919',
    firstName: 'רבקה',
    lastName: 'בן-דוד 3',
    departmentCode: 15,
    email: 'e1004@example.com',
  },
  {
    employeeNumber: '1005',
    idNumber: '312345671',
    firstName: 'יעקב',
    lastName: 'גולדשטיין',
    departmentCode: 15,
    email: 'e1005@example.com',
  },
  {
    employeeNumber: '1006',
    idNumber: '203456785',
    firstName: 'רחל',
    lastName: 'וייס',
    departmentCode: 15,
    email: 'e1006@example.com',
  },
  {
    employeeNumber: '1007',
    idNumber: '314159260',
    firstName: 'יוסף 2',
    lastName: 'שפירא',
    departmentCode: 15,
    email: null,
  },
  {
    employeeNumber: '1008',
    idNumber: '271828188',
    firstName: 'לאה',
    lastName: 'רוזנברג',
    departmentCode: 19,
    email: 'e1008@example.com',
  },
  {
    employeeNumber: '1009',
    idNumber: '300012341',
    firstName: 'דוד',
    lastName: 'הלוי-כץ',
    departmentCode: 19,
    email: 'e1009@example.com',
  },
  {
    employeeNumber: '1010',
    idNumber: '212121214',
    firstName: 'מרים',
    lastName: 'פישר',
    departmentCode: 19,
    email: 'e1010@example.com',
  },
  {
    employeeNumber: '1011',
    idNumber: '323232322',
    firstName: 'שמואל-אליהו',
    lastName: 'ברגר',
    departmentCode: 19,
    email: 'e1011@example.com',
  },
  {
    employeeNumber: '1012',
    idNumber: '234567899',
    firstName: 'חנה',
    lastName: 'קליין 4',
    departmentCode: 19,
    email: 'e1012@example.com',
  },
  {
    employeeNumber: '1013',
    idNumber: '345678908',
    firstName: 'יצחק',
    lastName: 'שוורץ',
    departmentCode: 19,
    email: 'e1013@example.com',
  },
  {
    employeeNumber: '1014',
    idNumber: '256789017',
    firstName: 'אסתר',
    lastName: 'לנדאו',
    departmentCode: 61,
    email: 'e1014@example.com',
  },
  {
    employeeNumber: '1015',
    idNumber: '367890126',
    firstName: 'נחום',
    lastName: 'בלום-הורוביץ',
    departmentCode: 61,
    email: null,
  },
  {
    employeeNumber: '1016',
    idNumber: '278901236',
    firstName: 'דבורה',
    lastName: 'אדלר',
    departmentCode: 61,
    email: 'e1016@example.com',
  },
  {
    employeeNumber: '1017',
    idNumber: '389012345',
    firstName: 'מנחם 3',
    lastName: 'גרינברג',
    departmentCode: 61,
    email: 'e1017@example.com',
  },
  {
    employeeNumber: '1018',
    idNumber: '290123454',
    firstName: 'פנינה',
    lastName: 'זילבר',
    departmentCode: 61,
    email: 'e1018@example.com',
  },
  {
    employeeNumber: '1019',
    idNumber: '301234563',
    firstName: 'אהרן',
    lastName: 'טננבאום',
    departmentCode: 61,
    email: 'e1019@example.com',
  },
  {
    employeeNumber: '1020',
    idNumber: '222333445',
    firstName: 'יהודית',
    lastName: 'בר-און 5',
    departmentCode: 61,
    email: 'e1020@example.com',
  },
];

/** Default settings (FR-ADM-2): the app's built-in defaults, so the two never differ. */
export const seedSettings: { key: string; value: number | string | null }[] = Object.entries(
  SETTING_DEFAULTS,
).map(([key, value]) => ({ key, value }));
