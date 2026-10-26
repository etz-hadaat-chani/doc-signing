import {
  type EmployerSignatureMode,
  type ErrorCode,
  errorMessage,
  fieldErrorSchema,
  isErrorCode,
  type TemplateCreateInput,
  templateCreateSchema,
  type TemplateItem,
  TEMPLATE_NAME_MAX_LENGTH,
  type TemplateUpdateInput,
  templateUpdateSchema,
} from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';

const form = he.templates.form;

export type TemplateFormField = 'name' | 'departmentIds' | 'file';
export type TemplateFieldErrors = Partial<Record<TemplateFormField, string>>;

export interface UploadValues {
  name: string;
  departmentIds: string[];
}

export interface SettingsValues extends UploadValues {
  employerSignatureMode: EmployerSignatureMode;
}

export function formFromItem(item: TemplateItem): SettingsValues {
  return {
    name: item.name,
    departmentIds: [...item.departments].sort((a, b) => a.code - b.code).map(({ id }) => id),
    employerSignatureMode: item.employerSignatureMode,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/** A schema problem in Hebrew: by field and kind, or the shared code's text when it has one. */
function issueText(field: TemplateFormField, issue: z.core.$ZodIssue): string {
  if (isErrorCode(issue.message)) return errorMessage(issue.message);
  if (field === 'departmentIds') return form.chooseDepartments;
  if (issue.code === 'too_big') return form.tooLong(TEMPLATE_NAME_MAX_LENGTH);
  return form.required;
}

function isFormField(value: unknown): value is TemplateFormField {
  return value === 'name' || value === 'departmentIds' || value === 'file';
}

/** The schema's problems, the first one per field. */
function schemaErrors(error: z.ZodError): TemplateFieldErrors {
  const errors: TemplateFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (isFormField(field) && errors[field] === undefined) errors[field] = issueText(field, issue);
  }
  return errors;
}

/** Upload: name, departments and a chosen file, with the server's own schema. */
export function checkUpload(
  values: UploadValues,
  file: File | null,
): { input: TemplateCreateInput | null; errors: TemplateFieldErrors } {
  const result = templateCreateSchema.safeParse(values);
  const errors = result.success ? {} : schemaErrors(result.error);
  if (!file) errors.file = form.chooseFile;
  if (!result.success || Object.keys(errors).length > 0) return { input: null, errors };
  return { input: result.data, errors };
}

export interface SettingsCheck {
  input: TemplateUpdateInput | null;
  errors: TemplateFieldErrors;
  /** Nothing changed: nothing to send. */
  unchanged: boolean;
  /**
   * The save makes the next version: the template is locked and its name or employer signature
   * changed (FR-TPL-4). Departments alone change the locked version in place.
   */
  createsVersion: boolean;
}

/** Settings: only what changed is sent, so the audit line names what the manager changed. */
export function checkSettings(values: SettingsValues, stored: TemplateItem): SettingsCheck {
  const before = formFromItem(stored);
  const raw: Record<string, unknown> = {};
  if (values.name.trim() !== before.name) raw.name = values.name;
  if (!sameSet(values.departmentIds, before.departmentIds))
    raw.departmentIds = values.departmentIds;
  if (values.employerSignatureMode !== before.employerSignatureMode) {
    raw.employerSignatureMode = values.employerSignatureMode;
  }
  if (Object.keys(raw).length === 0) {
    return { input: null, errors: {}, unchanged: true, createsVersion: false };
  }
  const createsVersion = stored.isLocked && ('name' in raw || 'employerSignatureMode' in raw);
  const result = templateUpdateSchema.safeParse(raw);
  if (!result.success) {
    return { input: null, errors: schemaErrors(result.error), unchanged: false, createsVersion };
  }
  return { input: result.data, errors: {}, unchanged: false, createsVersion };
}

/** API errors that belong to one field. The PDF ones say what to do with the file. */
const ERROR_FIELDS: Partial<Record<ErrorCode, TemplateFormField>> = {
  DEPARTMENT_NOT_FOUND: 'departmentIds',
  FILE_REQUIRED: 'file',
  FILE_TOO_LARGE: 'file',
  INVALID_PDF_FILE: 'file',
  PDF_ENCRYPTED: 'file',
  PDF_ACTIVE_CONTENT: 'file',
  PDF_FORM_FIELDS: 'file',
  PDF_ROTATED_PAGES: 'file',
  PDF_TOO_MANY_PAGES: 'file',
};

/**
 * A failed upload or save → the fields to mark, each with our own Hebrew text for the code
 * (never text from the response). Null when the error belongs to no field (a notification).
 */
export function serverFieldErrors(error: unknown): TemplateFieldErrors | null {
  if (!isApiRequestError(error) || error.code === null) return null;
  const field = ERROR_FIELDS[error.code];
  if (field) return { [field]: error.message };
  if (error.code !== 'VALIDATION_FAILED') return null;

  const parsed = z.array(fieldErrorSchema).safeParse(error.details?.fields);
  if (!parsed.success) return null;
  const errors: TemplateFieldErrors = {};
  for (const item of parsed.data) {
    const name = item.field.split('.')[0];
    if (isFormField(name) && errors[name] === undefined) errors[name] = errorMessage(item.code);
  }
  return Object.keys(errors).length === 0 ? null : errors;
}
