import type { EmailStatus, EmployerSignatureMode } from '@doc-signing/shared';
import type { ValuesEmployee } from '../../src/modules/pdf-filler/field-values.js';
import type { RecipientEmployee } from '../../src/modules/rounds/recipient-outcome.js';
import type {
  CandidateTemplate,
  RoundDepartment,
} from '../../src/modules/rounds/round-templates.js';
import { templateUsability } from '../../src/modules/templates/templates.service.js';
import { type FieldSpec, layout, madeUpEmployee } from './contracts.js';

/** A made-up uuid from a small number, e.g. uuidOf(7) = 00000000-0000-4000-8000-000000000007. */
export function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const DEPT_15: RoundDepartment = { id: uuidOf(15), code: 15, name: 'ממלאות מקום ירושלים' };
export const DEPT_19: RoundDepartment = { id: uuidOf(19), code: 19, name: 'ממ חינוך מיוחד' };
export const DEPT_61: RoundDepartment = { id: uuidOf(61), code: 61, name: 'ממלאות מקום אלעד-61' };

/** A ready contract: name, ID, address, an optional landline, the email pair and a signature. */
export const READY_FIELDS: FieldSpec[] = [
  { fieldType: 'full_name' },
  { fieldType: 'id_number' },
  { fieldType: 'address' },
  { fieldType: 'landline', isRequired: false },
  { fieldType: 'email_input' },
  { fieldType: 'no_email_checkbox' },
  { fieldType: 'signature' },
];

export interface CandidateOptions {
  id: number;
  name?: string;
  version?: number;
  departments?: RoundDepartment[];
  fields?: FieldSpec[];
  employerSignatureMode?: EmployerSignatureMode;
  isArchived?: boolean;
  isLatest?: boolean;
  imageUploaded?: boolean;
}

/** A template version as the round sees it, without a database. */
export function candidateTemplate(options: CandidateOptions): CandidateTemplate {
  const fields = layout(options.fields ?? READY_FIELDS);
  const row = {
    id: uuidOf(1000 + options.id),
    name: options.name ?? `חוזה ${String(options.id)}`,
    kind: 'signature' as const,
    fileKey: `templates/${uuidOf(1000 + options.id)}.pdf`,
    pageCount: 1,
    version: options.version ?? 1,
    parentTemplateId: null,
    isLocked: false,
    isArchived: options.isArchived ?? false,
    employerSignatureMode: options.employerSignatureMode ?? ('none' as const),
    createdAt: new Date('2026-10-01T08:00:00Z'),
    updatedAt: new Date('2026-10-01T08:00:00Z'),
    isLatest: options.isLatest ?? true,
    departments: options.departments ?? [DEPT_15],
    fields: [],
  };
  return { row, fields, usability: templateUsability(row, fields, options.imageUploaded ?? true) };
}

export interface RecipientOptions {
  n: number;
  department?: RoundDepartment;
  isActive?: boolean;
  emailStatus?: EmailStatus;
  values?: Parameters<typeof madeUpEmployee>[0];
}

/** A made-up employee with a valid email, in department 15 unless said otherwise. */
export function recipientEmployee(options: RecipientOptions): RecipientEmployee {
  const values: ValuesEmployee = madeUpEmployee({
    employeeNumber: String(1000 + options.n),
    ...options.values,
  });
  return {
    id: uuidOf(options.n),
    employeeNumber: values.employeeNumber,
    firstName: values.firstName,
    lastName: values.lastName,
    isActive: options.isActive ?? true,
    emailStatus: options.emailStatus ?? 'valid',
    department: options.department ?? DEPT_15,
    values,
  };
}
