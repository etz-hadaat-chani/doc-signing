import type { RecipientsPreviewReport } from '@doc-signing/shared';
import { DEPARTMENTS, listItem } from '../../employees/employees.fixtures';
import { readyTemplate } from '../../templates/templates.fixtures';

/** Made-up data for the wizard's tests. No ID numbers, no email addresses. */

export const [DEPT_19, DEPT_15] = DEPARTMENTS as [
  (typeof DEPARTMENTS)[number],
  (typeof DEPARTMENTS)[number],
];
export const TEMPLATE_B_ID = '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
export const OTHER_EMPLOYEE_ID = '0e1f2a3b-4c5d-4e6f-9a7b-8c9d0e1f2a3b';
const ROUND_ID = '1f2a3b4c-5d6e-4f7a-8b8c-9d0e1f2a3b4c';

const ref = (employeeId: string, employeeNumber: string, name: string) => ({
  employeeId,
  employeeNumber,
  name,
  department: '15 - מחלקה לדוגמה א',
});

const emptyList = { total: 0, truncated: false, items: [] };

/** single_template, can be created: 3 in the round, one already signed, one inactive. */
export function report(overrides: Partial<RecipientsPreviewReport> = {}): RecipientsPreviewReport {
  return {
    mode: 'single_template',
    alreadySigned: 'skip',
    canCreate: true,
    blockers: [],
    warnings: [],
    counts: {
      recipients: 5,
      inRound: 3,
      willSendEmail: 1,
      noEmail: 1,
      missingData: 1,
      alreadySigned: 1,
      alreadyOpen: 0,
      noTemplate: 0,
      waitingForChoice: 0,
      inactive: 1,
    },
    departments: [
      {
        id: DEPT_15.id,
        code: 15,
        label: '15 - מחלקה לדוגמה א',
        recipients: 4,
        status: 'ready',
        template: { id: readyTemplate.id, name: readyTemplate.name, version: 1 },
        options: [],
        notOffered: [],
      },
    ],
    lists: {
      missingData: {
        total: 1,
        truncated: false,
        items: [
          {
            ...ref(listItem.id, '9001', 'עובדת לדוגמה'),
            missing: [
              { key: 'address', name: 'כתובת' },
              { key: 'mobile', name: 'טלפון נייד' },
            ],
          },
        ],
      },
      textWarnings: emptyList,
      noEmail: {
        total: 1,
        truncated: false,
        items: [
          {
            ...ref(OTHER_EMPLOYEE_ID, '9002', 'עובד בלי מייל'),
            reason: 'bounced',
            reasonLabel: 'x',
          },
        ],
      },
      alreadySigned: {
        total: 1,
        truncated: false,
        items: [
          {
            ...ref('2a3b4c5d-6e7f-4a8b-9c9d-0e1f2a3b4c5d', '9003', 'עובד שחתם'),
            roundId: ROUND_ID,
            roundName: 'סבב קודם',
            templateVersion: 1,
            signedAt: '2026-09-02T07:10:00.000Z',
            signMethod: 'digital',
          },
        ],
      },
      alreadyOpen: emptyList,
      inactivePicked: {
        total: 1,
        truncated: false,
        items: [ref('3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e', '9004', 'עובד לא פעיל')],
      },
    },
    ...overrides,
  };
}

/** by_department: department 19 has two ready templates and waits for a choice. */
export function byDepartmentReport(): RecipientsPreviewReport {
  const base = report();
  const options = [
    { id: readyTemplate.id, name: readyTemplate.name, version: 1 },
    { id: TEMPLATE_B_ID, name: 'חוזה אחר', version: 2 },
  ];
  return {
    ...base,
    mode: 'by_department',
    canCreate: false,
    blockers: [
      {
        code: 'DEPARTMENT_TEMPLATE_CHOICE_NEEDED',
        message: 'text from the server',
        departmentId: DEPT_19.id,
        templateId: null,
        reasons: [],
      },
    ],
    warnings: [
      {
        code: 'DEPARTMENT_HAS_NO_TEMPLATE',
        message: 'text from the server',
        departmentId: DEPT_15.id,
      },
    ],
    counts: { ...base.counts, waitingForChoice: 2, noTemplate: 4 },
    departments: [
      {
        id: DEPT_15.id,
        code: 15,
        label: '15 - מחלקה לדוגמה א',
        recipients: 4,
        status: 'no_template',
        template: null,
        options: [],
        notOffered: [
          {
            id: '4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f',
            name: 'תבנית לא מוכנה',
            version: 1,
            reasons: [{ code: 'NO_MAIN_SIGNATURE', message: 'x', keys: [] }],
          },
        ],
      },
      {
        id: DEPT_19.id,
        code: 19,
        label: '19 - מחלקה לדוגמה ב',
        recipients: 2,
        status: 'choice_needed',
        template: null,
        options,
        notOffered: [],
      },
    ],
  };
}
