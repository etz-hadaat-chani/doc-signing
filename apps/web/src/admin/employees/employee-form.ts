import {
  type CreateEmployeeInput,
  createEmployeeSchema,
  type EmployeeCard,
  errorMessage,
  fieldErrorSchema,
  formatDayIL,
  isErrorCode,
  type UpdateEmployeeInput,
  updateEmployeeSchema,
} from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';

/**
 * The add / edit form (A7, FR-EMP-7) as plain text values, and the way to the API's input. The
 * shared schemas (the server's rules) do the checking; this only reads the typed text and names
 * each problem in Hebrew next to its field.
 */

/** Every text field, in the form's order. */
export const FORM_FIELDS = [
  'employeeNumber',
  'idNumber',
  'firstName',
  'lastName',
  'departmentId',
  'email',
  'landline',
  'mobile',
  'address',
  'city',
  'birthDate',
  'jobTitle',
  'employmentStatus',
  'jobPercent',
  'workDays',
  'hoursBaseCode',
  'pensionFundA',
  'pensionFundB',
  'studyFund',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

export type FormValues = Record<FormField, string> & { isActive: boolean };
export type FieldErrors = Partial<Record<FormField, string>>;

/** Must not be empty. The employee number only when adding (it can't be changed). */
const REQUIRED: readonly FormField[] = ['employeeNumber', 'idNumber', 'firstName', 'lastName'];

/** Marked as required in the form: the department too; the employee number only when adding. */
export function isRequired(field: FormField, isEdit: boolean): boolean {
  if (field === 'employeeNumber') return !isEdit;
  return field === 'departmentId' || REQUIRED.includes(field);
}

const form = he.employees.form;

export function emptyForm(): FormValues {
  const values = Object.fromEntries(FORM_FIELDS.map((field) => [field, ''])) as Record<
    FormField,
    string
  >;
  return { ...values, isActive: true };
}

const textOf = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

/** The stored employee as the form shows it (birth date as DD/MM/YYYY). */
export function formFromCard(card: EmployeeCard): FormValues {
  return {
    employeeNumber: card.employeeNumber,
    idNumber: textOf(card.idNumber),
    firstName: card.firstName,
    lastName: card.lastName,
    departmentId: card.department.id,
    email: textOf(card.email),
    landline: textOf(card.landline),
    mobile: textOf(card.mobile),
    address: textOf(card.address),
    city: textOf(card.city),
    birthDate: card.birthDate === null ? '' : formatDayIL(card.birthDate),
    jobTitle: textOf(card.jobTitle),
    employmentStatus: textOf(card.employmentStatus),
    jobPercent: textOf(card.jobPercent),
    workDays: textOf(card.workDays),
    hoursBaseCode: textOf(card.hoursBaseCode),
    pensionFundA: textOf(card.pensionFundA),
    pensionFundB: textOf(card.pensionFundB),
    studyFund: textOf(card.studyFund),
    isActive: card.isActive,
  };
}

/** "3/5/1980" or "03/05/1980" → "1980-05-03"; null when it isn't a date in that shape. */
export function parseDay(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** "62.5" or "62,5" → 62.5; NaN when it isn't a number. */
function parseNumber(text: string): number {
  const cleaned = text.trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

/**
 * One field's typed text → the value the schema reads. Empty → null (clears an optional field;
 * a required one is caught before). A date or number that can't be read → an error.
 */
function readField(field: FormField, text: string): { value: unknown } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  if (field === 'birthDate') {
    const day = parseDay(trimmed);
    return day === null ? { error: form.dateInvalid } : { value: day };
  }
  if (field === 'jobPercent' || field === 'hoursBaseCode') {
    const number = parseNumber(trimmed);
    if (Number.isNaN(number)) {
      return { error: field === 'jobPercent' ? form.jobPercentInvalid : form.hoursBaseCodeInvalid };
    }
    return { value: number };
  }
  return { value: text };
}

/** A schema problem in Hebrew: the shared code's text when it has one, else by field and kind. */
function issueText(field: FormField, issue: z.core.$ZodIssue): string {
  if (isErrorCode(issue.message)) return errorMessage(issue.message);
  if (field === 'jobPercent') return form.jobPercentInvalid;
  if (field === 'hoursBaseCode') return form.hoursBaseCodeInvalid;
  if (field === 'departmentId') return form.chooseDepartment;
  if (field === 'birthDate') return errorMessage('INVALID_BIRTH_DATE');
  if (issue.code === 'too_big' && typeof issue.maximum === 'number') {
    return form.tooLong(issue.maximum);
  }
  if (issue.code === 'too_small') return form.required;
  return errorMessage('INVALID_VALUE');
}

function isFormField(value: unknown): value is FormField {
  return FORM_FIELDS.some((field) => field === value);
}

/** Reads the given fields, then checks them with the schema; the first problem per field wins. */
function check<T>(
  schema: z.ZodType<T>,
  values: FormValues,
  fields: readonly FormField[],
  extra: Record<string, unknown> = {},
): { input: T | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const raw: Record<string, unknown> = { ...extra };
  for (const field of fields) {
    const text = values[field];
    if (REQUIRED.includes(field) && text.trim() === '') {
      errors[field] = form.required;
      continue;
    }
    if (field === 'departmentId' && text === '') {
      errors[field] = form.chooseDepartment;
      continue;
    }
    const read = readField(field, text);
    if ('error' in read) errors[field] = read.error;
    else raw[field] = read.value;
  }
  const result = schema.safeParse(raw);
  if (result.success) {
    return Object.keys(errors).length === 0
      ? { input: result.data, errors }
      : { input: null, errors };
  }
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (isFormField(field) && errors[field] === undefined) errors[field] = issueText(field, issue);
  }
  return { input: null, errors };
}

/** Adding: every field (empty optional ones as null). */
export function checkNew(values: FormValues) {
  return check<CreateEmployeeInput>(createEmployeeSchema, values, FORM_FIELDS);
}

/**
 * Editing: only the fields that changed are sent, so the import's later overwrite and the audit
 * lines name what the manager really changed. A field emptied on purpose is a change: it is sent
 * as null and the server clears it. `unchanged` = nothing to send.
 */
export function checkEdit(values: FormValues, stored: EmployeeCard) {
  const before = formFromCard(stored);
  const changed = FORM_FIELDS.filter(
    (field) => field !== 'employeeNumber' && values[field].trim() !== before[field].trim(),
  );
  const extra = values.isActive === before.isActive ? {} : { isActive: values.isActive };
  if (changed.length === 0 && Object.keys(extra).length === 0) {
    return { input: null, errors: {}, unchanged: true };
  }
  return {
    ...check<UpdateEmployeeInput>(updateEmployeeSchema, values, changed, extra),
    unchanged: false,
  };
}

/** Which field an API error belongs to. */
const ERROR_FIELDS: Partial<Record<string, FormField>> = {
  ID_NUMBER_TAKEN: 'idNumber',
  EMPLOYEE_NUMBER_TAKEN: 'employeeNumber',
  DEPARTMENT_NOT_FOUND: 'departmentId',
};

/**
 * A failed save → the fields to mark, each with our own Hebrew text for the code (never text
 * from the response). Null when the error belongs to no field (shown as a notification).
 */
export function serverFieldErrors(error: unknown): FieldErrors | null {
  if (!isApiRequestError(error) || error.code === null) return null;
  const field = ERROR_FIELDS[error.code];
  if (field) return { [field]: error.message };
  if (error.code !== 'VALIDATION_FAILED') return null;

  const parsed = z.array(fieldErrorSchema).safeParse(error.details?.fields);
  if (!parsed.success) return null;
  const errors: FieldErrors = {};
  for (const item of parsed.data) {
    const name = item.field.split('.')[0];
    if (isFormField(name) && errors[name] === undefined) errors[name] = errorMessage(item.code);
  }
  return Object.keys(errors).length === 0 ? null : errors;
}
