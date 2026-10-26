import type {
  Department,
  EmployeeCard,
  EmployeeHistoryItem,
  EmployeeListItem,
  Paged,
} from '@doc-signing/shared';

/** Made-up data for the employee screens' tests. ID 000000018 has a valid check digit. */

export const DEPARTMENTS: Department[] = [
  { id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d', code: 19, name: 'מחלקה לדוגמה ב', isActive: true },
  { id: '1b2c3d4e-5f6a-4b7c-8d8e-9f0a1b2c3d4e', code: 15, name: 'מחלקה לדוגמה א', isActive: true },
];

export const EMPLOYEE_ID = '2c3d4e5f-6a7b-4c8d-9e9f-0a1b2c3d4e5f';

export const listItem: EmployeeListItem = {
  id: EMPLOYEE_ID,
  employeeNumber: '9001',
  firstName: 'עובדת',
  lastName: 'לדוגמה',
  department: { id: '1b2c3d4e-5f6a-4b7c-8d8e-9f0a1b2c3d4e', code: 15, name: 'מחלקה לדוגמה א' },
  email: 'sample@example.test',
  emailStatus: 'valid',
  isActive: true,
};

export function page<T>(items: T[], total = items.length): Paged<T> {
  return { items, total, page: 1, pageSize: 25 };
}

export const card: EmployeeCard = {
  ...listItem,
  idNumber: '000000018',
  landline: '02-1234567',
  mobile: '050-1234567',
  address: 'רחוב לדוגמה 1',
  city: 'עיר לדוגמה',
  birthDate: '1980-05-03',
  age: 46,
  jobTitle: 'תפקיד לדוגמה',
  employmentStatus: 'קבוע',
  jobPercent: 62.5,
  workDays: 'א-ה',
  hoursBaseCode: 1,
  hoursBaseLabel: '42 שעות',
  pensionFundA: 'קופה א לדוגמה',
  pensionFundB: null,
  studyFund: 'קרן לדוגמה',
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const SIGNED_ASSIGNMENT_ID = '3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a';
export const SENT_ASSIGNMENT_ID = '4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b';

const historyBase: EmployeeHistoryItem = {
  assignmentId: SIGNED_ASSIGNMENT_ID,
  round: {
    id: '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c',
    name: 'סבב לדוגמה',
    status: 'active',
    statusLabel: 'פעיל',
    correctionOf: null,
  },
  document: { id: '6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d', name: 'מסמך לדוגמה', version: 2 },
  department: { id: listItem.department.id, code: 15, label: '15 - מחלקה לדוגמה א' },
  status: 'signed',
  displayStatus: 'signed',
  statusLabel: 'נחתם',
  createdAt: '2026-09-01T07:00:00.000Z',
  sentAt: '2026-09-01T07:00:00.000Z',
  firstOpenedAt: '2026-09-02T07:00:00.000Z',
  signedAt: '2026-09-02T07:10:00.000Z',
  cancelledAt: null,
  lastUpdateAt: '2026-09-02T07:10:00.000Z',
  signMethod: 'digital',
  hasSignedFile: true,
  approval: null,
  returned: null,
};

export const history: EmployeeHistoryItem[] = [
  historyBase,
  {
    ...historyBase,
    assignmentId: SENT_ASSIGNMENT_ID,
    round: { ...historyBase.round, id: '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e', name: 'סבב ישן' },
    status: 'sent',
    displayStatus: 'sent',
    statusLabel: 'נשלח',
    signedAt: null,
    signMethod: null,
    hasSignedFile: false,
  },
];
