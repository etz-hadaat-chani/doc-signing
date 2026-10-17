import {
  ageOn,
  type EmployeeExtras,
  type EmployerSignatureMode,
  type FieldValues,
  isSystemValueType,
  missingValueName,
  PENSION_FIELD_TYPES,
  type PensionSource,
  type SavedEmployerSignature,
  SYSTEM_VALUE_NAMES,
  type SystemValueType,
  type TemplateFieldSettings,
} from '@doc-signing/shared';

/** What the values step reads of an employee: the row's plain values, no database. */
export interface ValuesEmployee {
  firstName: string;
  lastName: string;
  /** 9 digits, leading zeros kept (as stored). */
  idNumber: string;
  employeeNumber: string;
  email: string | null;
  details: EmployeeExtras & { landline: string | null; mobile: string | null };
}

export interface BuildFieldValuesInput {
  employee: ValuesEmployee;
  /** The template's positions with their settings (`toPosition`), in `sort_order`. */
  fields: readonly TemplateFieldSettings[];
  employerSignatureMode: EmployerSignatureMode;
  /** The current employer signature setting (3.18), or null when none was uploaded. */
  employerSignature: SavedEmployerSignature | null;
  /** The send day (or the preview day) in Israel, `YYYY-MM-DD` (`todayInIsrael`). */
  sendDay: string;
}

/** A box by its key and its Hebrew field name; never the value. */
export interface NamedKey {
  key: string;
  name: string;
}

export interface FieldValuesResult {
  /** Plain JSON: what 3.10 saves as `assignments.field_values`. */
  fieldValues: FieldValues;
  /** Required system-only values that are empty (FR-TPL-6): the assignment is "missing data". */
  missing: NamedKey[];
  /** `system_then_employee` values that are empty: the employee fills them in (FR-TPL-10). */
  leftForEmployee: NamedKey[];
}

const trimmed = (value: string | null): string => value?.trim() ?? '';

/** The text a system value is drawn as, or "" when the employee has none. */
function systemValue(type: SystemValueType, employee: ValuesEmployee, sendDay: string): string {
  const { details } = employee;
  switch (type) {
    case 'full_name':
      return [employee.firstName, employee.lastName].map(trimmed).filter(Boolean).join(' ');
    case 'id_number':
      return employee.idNumber;
    case 'employee_number':
      return employee.employeeNumber;
    case 'address':
      // "כתובת, יישוב": whichever parts exist (FR-TPL-2).
      return [details.address, details.city].map(trimmed).filter(Boolean).join(', ');
    case 'landline':
      return trimmed(details.landline);
    case 'mobile':
      return trimmed(details.mobile);
    case 'age':
      return details.birthDate === null ? '' : String(ageOn(details.birthDate, sendDay));
    case 'job_title':
      return trimmed(details.jobTitle);
    case 'employment_status':
      return trimmed(details.employmentStatus);
    case 'job_percent':
      return details.jobPercent === null ? '' : `${String(details.jobPercent)}%`;
    case 'work_days':
      return trimmed(details.workDays);
    case 'study_fund':
      return trimmed(details.studyFund);
  }
}

/** The fund name by the pension source (FR-TPL-5): `a_then_b` → א, else ב; `b_only` → ב. */
function pensionFundName(source: PensionSource, details: ValuesEmployee['details']): string {
  const fundA = trimmed(details.pensionFundA);
  const fundB = trimmed(details.pensionFundB);
  return source === 'a_then_b' ? fundA || fundB : fundB;
}

const isPensionType = (type: string) => (PENSION_FIELD_TYPES as readonly string[]).includes(type);

/**
 * The values step (FR-TPL-2, FR-TPL-5, FR-TPL-6, FR-RND-8): employee + send day + template →
 * the values drawn on the document, what is missing and what is left for the employee. Pure: no
 * database, no clock. Used by the template preview (3.6), the recipient preview (3.8), the send
 * (3.10, saved as `field_values`) and manual handling (3.16).
 *
 * - Only keys the template uses are in `values`. The hours base code is never a value (3.19).
 * - `system` + required + empty → `missing`; `system` + optional + empty → "" (drawn blank).
 *   A required value with a condition still counts: the condition may turn on.
 * - `system_then_employee` + empty → "" and `leftForEmployee`, never missing. `employee` → none.
 * - Pension: a fund name → "has a fund" ticked and the name; none → "no fund" ticked. Never missing.
 * - `email_input` (employee only) still gets the stored email as the form's pre-fill (FR-SGN-9).
 * - The employer signature image is kept when the mode is `pre_signed` or `after_employee`.
 */
export function buildFieldValues(input: BuildFieldValuesInput): FieldValuesResult {
  const { employee, sendDay } = input;
  const values: FieldValues['values'] = {};
  const missing: NamedKey[] = [];
  const leftForEmployee: NamedKey[] = [];

  // Positions with the same key are one box (3.20): the first one stands for it.
  const boxes = new Map<string, TemplateFieldSettings>();
  for (const field of input.fields) if (!boxes.has(field.key)) boxes.set(field.key, field);

  for (const box of boxes.values()) {
    const { key, fieldType: type } = box;
    if (isSystemValueType(type)) {
      if (box.fillMode === 'employee') continue;
      const value = systemValue(type, employee, sendDay);
      values[key] = value;
      if (value !== '') continue;
      if (box.fillMode === 'system_then_employee') {
        leftForEmployee.push({ key, name: SYSTEM_VALUE_NAMES[type] });
      } else if (box.isRequired) {
        missing.push({ key, name: missingValueName(type) });
      }
    } else if (isPensionType(type)) {
      const name = pensionFundName(box.options?.pensionSource ?? 'a_then_b', employee.details);
      if (type === 'pension_fund_name') values[key] = name;
      else if (type === 'pension_has_fund') values[key] = name !== '';
      else values[key] = name === '';
    } else if (type === 'email_input') {
      values[key] = trimmed(employee.email);
    }
    // The date (drawn as the view or signing day), the boxes and signatures: no value here.
  }

  const image = input.employerSignatureMode === 'none' ? null : input.employerSignature;
  const employerSignature = image && {
    fileKey: image.fileKey,
    width: image.width,
    height: image.height,
    sha256: image.sha256,
  };

  return {
    fieldValues: { version: 1, sendDay, values, employerSignature },
    missing,
    leftForEmployee,
  };
}
