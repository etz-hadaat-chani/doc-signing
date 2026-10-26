import type { ImportCommitResult, ImportPreview } from '@doc-signing/shared';

/** Made-up data for the import screen's tests: no real names, numbers or emails. */

export const BATCH_ID = '8c9d0e1f-2a3b-4c4d-9e5f-6a7b8c9d0e1f';

export const preview: ImportPreview = {
  batchId: BATCH_ID,
  fileName: 'עובדים לדוגמה.xlsx',
  counts: {
    rowsTotal: 6,
    rowsNew: 2,
    rowsUpdated: 1,
    rowsUnchanged: 1,
    rowsFailed: 2,
    departmentsNew: 1,
    departmentsRenamed: 1,
  },
  newEmployees: [
    {
      row: 2,
      employeeNumber: '9101',
      fullName: 'עובדת חדשה',
      department: '15 - מחלקה לדוגמה א',
      emailStatus: 'missing',
    },
    {
      row: 3,
      employeeNumber: '9102',
      fullName: 'עובד חדש',
      department: '31 - מחלקה חדשה לדוגמה',
      emailStatus: 'invalid',
    },
  ],
  updatedEmployees: [
    {
      row: 4,
      employeeNumber: '9001',
      fullName: 'עובדת לדוגמה',
      changes: [
        'firstName: דנה → דינה',
        'departmentCode: 15 → 31',
        'email: (none) → sample@example.test',
        'emailStatus: missing → valid',
        'mobile: 050-1111111 → (none)',
        'idNumber: changed',
      ],
    },
  ],
  newDepartments: [{ code: 31, name: 'מחלקה חדשה לדוגמה' }],
  renamedDepartments: [{ code: 19, from: 'מחלקה לדוגמה ב', to: 'מחלקה לדוגמה ב חדשה' }],
  errors: [
    {
      row: 6,
      employeeNumber: '9103',
      code: 'ID_NUMBER_INVALID',
      message: 'מספר תעודת הזהות אינו תקין (ספרת ביקורת או מבנה)',
    },
    {
      row: 7,
      employeeNumber: null,
      code: 'EMPLOYEE_NUMBER_MISSING',
      message: 'חסר מספר עובד',
    },
  ],
  warnings: [
    {
      row: 3,
      employeeNumber: '9102',
      code: 'EMAIL_INVALID',
      message: 'כתובת האימייל אינה תקינה. העובד יישמר עם סטטוס "אימייל לא תקין"',
    },
  ],
};

/** Only unchanged rows and one error: nothing to import. */
export const nothingToDo: ImportPreview = {
  ...preview,
  counts: {
    rowsTotal: 2,
    rowsNew: 0,
    rowsUpdated: 0,
    rowsUnchanged: 1,
    rowsFailed: 1,
    departmentsNew: 0,
    departmentsRenamed: 0,
  },
  newEmployees: [],
  updatedEmployees: [],
  newDepartments: [],
  renamedDepartments: [],
  errors: preview.errors.slice(0, 1),
  warnings: [],
};

/** 30 new employees, for paging inside a tab. */
export const manyNew: ImportPreview = {
  ...nothingToDo,
  counts: { ...nothingToDo.counts, rowsTotal: 30, rowsNew: 30, rowsUnchanged: 0, rowsFailed: 0 },
  errors: [],
  newEmployees: Array.from({ length: 30 }, (_, index) => ({
    row: index + 2,
    employeeNumber: String(9200 + index),
    fullName: 'עובד לדוגמה',
    department: '15 - מחלקה לדוגמה א',
    emailStatus: 'missing' as const,
  })),
};

export const commitResult: ImportCommitResult = {
  batchId: BATCH_ID,
  status: 'committed',
  counts: preview.counts,
  committedAt: '2026-10-26T08:00:00.000Z',
};
