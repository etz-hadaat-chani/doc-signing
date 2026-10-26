import { formatDepartment, type TemplateField, type TemplateItem } from '@doc-signing/shared';
import { DEPARTMENTS } from '../employees/employees.fixtures';

/** Made-up templates for the template screens' tests. */

export const TEMPLATE_ID = '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c';
export const VERSION_2_ID = '6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d';
export const VERSION_3_ID = '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';

/** Linked out of code order (19, then 15): screens must sort them. */
export const linkedDepartments = DEPARTMENTS.map(({ id, code, name }) => ({
  id,
  code,
  name,
  label: formatDepartment(code, name),
}));

function field(id: number, fieldType: TemplateField['fieldType'], key: string): TemplateField {
  return {
    id: `8c9d0e1f-2a3b-4c4d-9e5f-6a7b8c9d0e${String(id).padStart(2, '0')}`,
    fieldType,
    key,
    fillMode: fieldType === 'signature' ? null : fieldType === 'select' ? 'employee' : 'system',
    showWhen: null,
    options: fieldType === 'select' ? { choices: ['כן'] } : null,
    isRequired: true,
    label: null,
    needsApproval: false,
    page: 1,
    x: 100,
    y: 700 - id * 30,
    width: 200,
    height: 20,
  };
}

export const FIELDS: TemplateField[] = [
  field(1, 'full_name', 'full_name'),
  field(2, 'id_number', 'id_number'),
  field(3, 'select', 'box_1'),
];

/** Version 1: not ready (no signature, a list without a label and too few options). */
export const template: TemplateItem = {
  id: TEMPLATE_ID,
  name: 'חוזה לדוגמה',
  kind: 'signature',
  version: 1,
  parentTemplateId: null,
  pageCount: 2,
  isLocked: false,
  isArchived: false,
  isLatest: true,
  employerSignatureMode: 'none',
  departments: linkedDepartments,
  fields: FIELDS,
  isReady: false,
  notReadyReasons: [
    { code: 'NO_MAIN_SIGNATURE', message: 'x', keys: [] },
    { code: 'LABEL_MISSING', message: 'x', keys: ['box_1'] },
    { code: 'TOO_FEW_CHOICES', message: 'x', keys: ['box_1'] },
  ],
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-02T08:00:00.000Z',
};

export const readyTemplate: TemplateItem = {
  ...template,
  isReady: true,
  notReadyReasons: [],
};

/** Three versions of one template: 1 (old, locked), 2 (old, locked), 3 (latest). */
export function versions(): TemplateItem[] {
  return [
    { ...readyTemplate, isLocked: true, isLatest: false },
    {
      ...readyTemplate,
      id: VERSION_2_ID,
      version: 2,
      parentTemplateId: TEMPLATE_ID,
      isLocked: true,
      isLatest: false,
      createdAt: '2026-10-05T08:00:00.000Z',
    },
    {
      ...readyTemplate,
      id: VERSION_3_ID,
      version: 3,
      parentTemplateId: VERSION_2_ID,
      createdAt: '2026-10-09T08:00:00.000Z',
    },
  ];
}

export function page<T>(items: T[], total = items.length) {
  return { items, total, page: 1, pageSize: 25 };
}
