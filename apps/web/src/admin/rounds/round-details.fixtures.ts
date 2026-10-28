import {
  type AssignmentRow,
  type DisplayStatus,
  emptyDisplayCounts,
  type Paged,
  type RoundDetails,
  type RoundListItem,
} from '@doc-signing/shared';

// Made-up data only ("עובד/ת לדוגמה", "מחלקה לדוגמה"); no ID numbers anywhere.

export const ROUND_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
export const ORIGINAL_ROUND_ID = '2c5f39cb-3ab2-42e3-994a-1127e4ddb538';
export const CORRECTION_ROUND_ID = '3d6a4adc-4bc3-43f4-8a5b-2238f5eec649';
export const DEPT_A = '4e7b5bed-5cd4-44a5-9b6c-3349a6ffd75a';
export const DEPT_B = '5f8c6cfe-6de5-45b6-8c7d-445ab7aae86b';

export function counts(values: Partial<Record<DisplayStatus, number>>) {
  return { ...emptyDisplayCounts(), ...values };
}

export const listItem: RoundListItem = {
  id: ROUND_ID,
  name: 'הצהרת בריאות לדוגמה',
  mode: 'single_template',
  status: 'active',
  statusLabel: 'פעיל',
  isCorrection: false,
  documents: [{ id: '6a9d7d0f-7ef6-46c7-9d8e-556bc8bbf97c', name: 'טופס לדוגמה', version: 2 }],
  createdAt: '2026-10-01T07:00:00.000Z',
  draftAgeDays: null,
  sentAt: '2026-10-01T08:00:00.000Z',
  linkExpiresAt: '2026-11-30T08:00:00.000Z',
  closedAt: null,
  recipients: 1300,
  signed: 300,
  percentSigned: 23,
};

export function paged<T>(items: T[], total = items.length, page = 1, pageSize = 25): Paged<T> {
  return { items, total, page, pageSize };
}

export const details: RoundDetails = {
  id: ROUND_ID,
  name: 'הצהרת בריאות לדוגמה',
  mode: 'by_department',
  status: 'active',
  statusLabel: 'פעיל',
  isCorrection: false,
  documents: listItem.documents,
  createdAt: '2026-10-01T07:00:00.000Z',
  draftAgeDays: null,
  sentAt: '2026-10-01T08:00:00.000Z',
  linkExpiresAt: '2026-11-30T08:00:00.000Z',
  closedAt: null,
  createdBy: { id: '7b0e8e10-8f07-47d8-8e9f-667cd9ccc08d', fullName: 'מנהלת לדוגמה' },
  settings: {
    remindersEnabled: true,
    reminderIntervalDays: 3,
    maxReminders: null,
    linkExpiryDays: 60,
  },
  templates: [
    {
      departmentId: DEPT_A,
      department: '15 - מחלקה לדוגמה א',
      template: { id: '6a9d7d0f-7ef6-46c7-9d8e-556bc8bbf97c', name: 'טופס לדוגמה', version: 2 },
    },
  ],
  progress: { queued: 0, sent: 10, failed: 0, total: 10 },
  counts: {
    total: 10,
    percentSigned: 50,
    byStatus: counts({
      sent: 2,
      signed: 3,
      waiting_for_approval: 1,
      cancelled: 2,
      returned_for_correction: 1,
      locked: 1,
    }),
    cancelledInactiveAtSend: 1,
  },
  departments: [
    {
      id: DEPT_A,
      code: 15,
      label: '15 - מחלקה לדוגמה א',
      total: 6,
      percentSigned: 60,
      byStatus: counts({ sent: 1, signed: 3, cancelled: 2 }),
    },
    {
      id: DEPT_B,
      code: 120,
      label: '120 - מחלקה לדוגמה ב',
      total: 4,
      percentSigned: 33,
      byStatus: counts({ sent: 1, waiting_for_approval: 1, returned_for_correction: 1, locked: 1 }),
    },
  ],
  correctionOf: null,
};

export const row: AssignmentRow = {
  assignmentId: '8c1f9f21-9018-48e9-9fa0-778de0ddd19e',
  employeeId: '9d2a0a32-a129-49fa-8ab1-889ef1eee2af',
  employeeNumber: 'D-0001',
  firstName: 'עובדת',
  lastName: 'לדוגמה',
  department: { id: DEPT_A, code: 15, label: '15 - מחלקה לדוגמה א' },
  status: 'sent',
  displayStatus: 'sent',
  statusLabel: 'נשלח',
  locked: false,
  unlocksLeft: 2,
  sentAt: '2026-10-01T08:00:00.000Z',
  firstOpenedAt: null,
  signedAt: null,
  lastUpdateAt: '2026-10-04T06:00:00.000Z',
  reminderCount: 1,
  lastReminderAt: '2026-10-04T06:00:00.000Z',
  signMethod: null,
  hasSignedFile: false,
  hasAnswers: false,
  approval: null,
  emailAnswer: null,
  cancelReason: null,
  returned: null,
};

export const signedRow: AssignmentRow = {
  ...row,
  assignmentId: 'ae3b1b43-b23a-4a0b-9bc2-99afa2fff3b0',
  employeeId: 'bf4c2c54-c34b-4b1c-8cd3-aab0b3aaa4c1',
  employeeNumber: 'D-0002',
  firstName: 'עובד',
  status: 'signed',
  displayStatus: 'signed',
  statusLabel: 'נחתם',
  firstOpenedAt: '2026-10-02T08:00:00.000Z',
  signedAt: '2026-10-02T08:05:00.000Z',
  lastUpdateAt: '2026-10-02T08:05:00.000Z',
  reminderCount: 0,
  lastReminderAt: null,
  signMethod: 'digital',
  hasSignedFile: true,
  emailAnswer: {
    choice: 'email',
    choiceLabel: 'מייל',
    email: 'given@example.test',
    differsFromStored: true,
  },
};

export const returnedRow: AssignmentRow = {
  ...signedRow,
  assignmentId: 'c05d3d65-d45c-4c2d-8de4-bbc1c4bbb5d2',
  employeeNumber: 'D-0003',
  status: 'cancelled',
  displayStatus: 'returned_for_correction',
  statusLabel: 'הוחזר לתיקון',
  emailAnswer: null,
  cancelReason: 'returned',
  returned: {
    at: '2026-10-03T08:00:00.000Z',
    correctionRound: { id: CORRECTION_ROUND_ID, name: 'תיקון: הצהרת בריאות לדוגמה' },
  },
};

export const expiredLockedRow: AssignmentRow = {
  ...row,
  assignmentId: 'd16e4e76-e56d-4d3e-8ef5-ccd2d5ccc6e3',
  employeeNumber: 'D-0004',
  displayStatus: 'expired',
  statusLabel: 'פג תוקף',
  locked: true,
};

export const detailsPath = `/api/rounds/${ROUND_ID}`;
export const tablePath = (query = 'page=1&pageSize=25') =>
  `/api/rounds/${ROUND_ID}/assignments?${query}`;
export const searchPath = `/api/rounds/${ROUND_ID}/assignments/search`;
