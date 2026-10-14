import type { FixtureRow } from './har-gal-workbook.js';

/**
 * A made-up Har Gal export with one case of everything, against the seed (prisma/seed-data.ts).
 * Used by the import API test and `pnpm import:sample`. Excel row numbers in the comments (row 1
 * is the header). Before the preview, the test (and the sample script's instructions) set:
 * 1002 and 1003 → email status bounced; 1004 → phone 050-7654321 (a manual edit).
 */
export const SAMPLE_ROWS: (FixtureRow | null)[] = [
  // 2: new. Number and ID sent as numbers, the ID lost its leading 0 (055500003). Last name in
  // rich text, email as a hyperlink, mobile prefix sent as the number 50. New department 45 with
  // a hyphen and digits in its name.
  {
    employeeNumber: 2001,
    idNumber: 55500003,
    firstName: 'נועה',
    lastName: { richText: [{ text: 'לו' }, { text: 'י' }] },
    department: '45 - ממלאות מקום אלעד-45',
    email: { text: 'Noa.Levi@Example.com', hyperlink: 'mailto:noa.levi@example.com' },
    mobilePrefix: 50,
    mobile: 1234567,
  },
  // 3: new, no email (status missing). Department from a formula; landline phone.
  {
    employeeNumber: '2002',
    idNumber: '077700003',
    firstName: 'יוסף',
    lastName: 'מזרחי',
    department: {
      formula: '"15 - "&"ממלאות מקום ירושלים"',
      result: '15 - ממלאות מקום ירושלים',
    },
    phonePrefix: '02',
    phone: 6234567,
  },
  // 4: unchanged (seed 1001 as stored).
  {
    employeeNumber: 1001,
    idNumber: 12345674,
    firstName: 'משה',
    lastName: 'כהן',
    department: '15 - ממלאות מקום ירושלים',
    email: 'e1001@example.com',
  },
  // 5: updated: new email for 1002, whose stored email bounced → status valid again.
  {
    employeeNumber: 1002,
    idNumber: 23456783,
    firstName: 'שרה',
    lastName: 'כהן-לוי 2',
    department: '15 - ממלאות מקום ירושלים',
    email: 'sarah.new@example.com',
  },
  // 6: unchanged: 1003's same email (other case, spaces) → bounced stays bounced.
  {
    employeeNumber: 1003,
    idNumber: 34567891,
    firstName: 'אברהם-חיים',
    lastName: 'פרידמן',
    department: '15 - ממלאות מקום ירושלים',
    email: ' E1003@Example.com ',
  },
  // 7: updated: 1004 moves to 19 (renamed in the file) and loses the phone a manager added.
  {
    employeeNumber: 1004,
    idNumber: 45678919,
    firstName: 'רבקה',
    lastName: 'בן-דוד 3',
    department: '19 - ממ חינוך מיוחד חדש',
    email: 'e1004@example.com',
  },
  // 8: empty, skipped.
  null,
  // 9: new with two warnings: bad email (saved as invalid) and an unreadable phone (saved empty).
  {
    employeeNumber: 2003,
    idNumber: 88800008,
    firstName: 'אסתר',
    lastName: 'פרץ',
    department: '61 - ממלאות מקום אלעד-61',
    email: 'esther@@example',
    mobilePrefix: 50,
    mobile: 12,
  },
  // 10: error: wrong ID check digit.
  {
    employeeNumber: 2004,
    idNumber: 12345678,
    firstName: 'דוד',
    lastName: 'שפירא',
    department: '15 - ממלאות מקום ירושלים',
  },
  // 11, 12: error: the same employee number twice.
  {
    employeeNumber: 2005,
    idNumber: 99900003,
    firstName: 'חנה',
    lastName: 'רוזן',
    department: '15 - ממלאות מקום ירושלים',
  },
  {
    employeeNumber: 2005,
    idNumber: 111100004,
    firstName: 'חנה',
    lastName: 'רוזנברג',
    department: '15 - ממלאות מקום ירושלים',
  },
  // 13, 14: error: the same ID number twice.
  {
    employeeNumber: 2006,
    idNumber: 222200008,
    firstName: 'אליהו',
    lastName: 'דהן',
    department: '15 - ממלאות מקום ירושלים',
  },
  {
    employeeNumber: 2007,
    idNumber: 222200008,
    firstName: 'אלי',
    lastName: 'דהן',
    department: '15 - ממלאות מקום ירושלים',
  },
  // 15: error: department cell without a code.
  {
    employeeNumber: 2008,
    idNumber: 333300002,
    firstName: 'מרים',
    lastName: 'אזולאי',
    department: 'ממלאות מקום',
  },
  // 16, 17: error: department 70 under two names.
  {
    employeeNumber: 2009,
    idNumber: 444400006,
    firstName: 'שמעון',
    lastName: 'ביטון',
    department: '70 - מחלקה א',
  },
  {
    employeeNumber: 2010,
    idNumber: 666600002,
    firstName: 'לאה',
    lastName: 'ביטון',
    department: '70 - מחלקה ב',
  },
  // 18: error: the ID of seed employee 1005.
  {
    employeeNumber: 2011,
    idNumber: 312345671,
    firstName: 'נתן',
    lastName: 'גל',
    department: '15 - ממלאות מקום ירושלים',
  },
  // 19: error: no first name.
  {
    employeeNumber: 2012,
    idNumber: 787800002,
    lastName: 'עמר',
    department: '15 - ממלאות מקום ירושלים',
  },
];
