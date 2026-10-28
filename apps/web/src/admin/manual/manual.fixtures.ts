import type { ManualRow, Paged } from '@doc-signing/shared';

/** Made-up data for the manual-handling tests. Never an ID number. */

export const ROUND_ID = '3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a';
export const DEPT_ID = '1b2c3d4e-5f6a-4b7c-8d8e-9f0a1b2c3d4e';

const id = (n: number) => `4e5f6a7b-8c9d-4e0f-8a1b-${String(n).padStart(12, '0')}`;
const employeeId = (n: number) => `5f6a7b8c-9d0e-4f1a-8b2c-${String(n).padStart(12, '0')}`;

function manualRow(n: number, extra: Partial<ManualRow>): ManualRow {
  return {
    assignmentId: id(n),
    kind: 'no_email',
    status: 'no_email',
    round: { id: ROUND_ID, name: 'סבב לדוגמה' },
    documentName: 'מסמך לדוגמה',
    department: { id: DEPT_ID, code: 15, name: 'מחלקה לדוגמה א' },
    employee: {
      id: employeeId(n),
      employeeNumber: String(9000 + n),
      firstName: `עובד${String(n)}`,
      lastName: 'לדוגמה',
      isActive: true,
      emailStatus: 'missing',
    },
    ready: null,
    newEmail: null,
    missing: [],
    emailCorrection: null,
    locked: false,
    unlocksLeft: 2,
    linkExpired: false,
    sentAt: '2026-10-20T07:00:00.000Z',
    signedAt: null,
    ...extra,
  };
}

/** No email yet: print, scan, fix email. */
export const noEmail = manualRow(1, {});

/** An email was added: ready to send. */
export const emailAdded = manualRow(2, {
  ready: 'email_added',
  newEmail: 'added@example.test',
  employee: {
    ...noEmail.employee,
    id: employeeId(2),
    employeeNumber: '9002',
    firstName: 'עובד2',
    emailStatus: 'valid',
  },
});

/** Missing details: names only. */
export const missingData = manualRow(3, {
  kind: 'missing_data',
  status: 'missing_data',
  missing: ['כתובת', 'עיר'],
  employee: {
    ...noEmail.employee,
    id: employeeId(3),
    employeeNumber: '9003',
    firstName: 'עובד3',
    emailStatus: 'valid',
  },
});

/** Signed, and she gave another email. */
export const corrected = manualRow(4, {
  kind: 'email_corrected',
  status: 'signed',
  emailCorrection: { stored: 'old@example.test', given: 'new@example.test' },
  signedAt: '2026-10-22T08:00:00.000Z',
  employee: {
    ...noEmail.employee,
    id: employeeId(4),
    employeeNumber: '9004',
    firstName: 'עובד4',
    emailStatus: 'valid',
  },
});

/** Locked after 5 wrong ID numbers, no unlocks left. */
export const lockedOut = manualRow(5, {
  kind: 'locked',
  status: 'opened',
  locked: true,
  unlocksLeft: 0,
  employee: {
    ...noEmail.employee,
    id: employeeId(5),
    employeeNumber: '9005',
    firstName: 'עובד5',
    emailStatus: 'valid',
  },
});

export const ROWS = [noEmail, emailAdded, missingData, corrected, lockedOut];

export function paged<T>(items: T[], total = items.length): Paged<T> {
  return { items, total, page: 1, pageSize: 25 };
}
