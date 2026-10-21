import {
  type AlreadySignedChoice,
  type EmailStatus,
  isSystemValueType,
  type NoEmailReason,
  OPEN_ASSIGNMENT_STATUSES,
  PENSION_FUND_NAME_LABEL,
  type RecipientTextWarningCode,
  type RoundDepartmentStatus,
  type SavedEmployerSignature,
  type SignMethod,
  SYSTEM_VALUE_NAMES,
} from '@doc-signing/shared';
import {
  buildFieldValues,
  type NamedKey,
  type ValuesEmployee,
} from '../pdf-filler/field-values.js';
import { checkTextFit, type TextFitCache, type TextFont } from '../pdf-filler/pdf-text.js';
import type { FieldPosition } from '../templates/template-changes.js';
import type { CandidateTemplate, RoundDepartment } from './round-templates.js';

/** One employee the choice names, with what the values step reads. */
export interface RecipientEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  emailStatus: EmailStatus;
  /** The employee's department now: it becomes `assignments.department_id` (3.9). */
  department: RoundDepartment;
  values: ValuesEmployee;
}

/** The same document (any version) signed in an earlier round. */
export interface SignedBefore {
  roundId: string;
  roundName: string;
  templateVersion: number;
  signedAt: Date | null;
  signMethod: SignMethod | null;
}

/** The same document (any version) still waiting in another round that can be signed. */
export interface OpenElsewhere {
  roundId: string;
  roundName: string;
  status: (typeof OPEN_ASSIGNMENT_STATUSES)[number];
}

/**
 * What happens to one recipient, the first that applies, in this order (3.8):
 * inactive → no template → waiting for a choice → already signed (when skipping) → already
 * open → missing data → no email → email. Missing data wins over no email (3.9).
 */
export type RecipientOutcome =
  | 'inactive'
  | 'no_template'
  | 'waiting_for_choice'
  | 'already_signed'
  | 'already_open'
  | 'missing_data'
  | 'no_email'
  | 'email';

/** The outcomes that add the employee to the round (3.9 creates one assignment each). */
export const IN_ROUND_OUTCOMES: readonly RecipientOutcome[] = ['email', 'no_email', 'missing_data'];

export interface RecipientTextWarning {
  code: RecipientTextWarningCode;
  keys: NamedKey[];
}

export interface ResolvedRecipient {
  employee: RecipientEmployee;
  /** Named in `recipients.employeeIds`. */
  pickedByHand: boolean;
  /** The template the employee gets; null when the department has none or needs a choice. */
  template: CandidateTemplate | null;
  outcome: RecipientOutcome;
  signedBefore: SignedBefore | null;
  openElsewhere: OpenElsewhere | null;
  /** Required system-only values that are empty (field names only). */
  missing: NamedKey[];
  /** Text that won't draw as it is (box keys and names only); doesn't stop the send. */
  textWarnings: RecipientTextWarning[];
  /** Set when the employee has no usable email. */
  noEmailReason: NoEmailReason | null;
}

export interface ResolveRecipientInput {
  employee: RecipientEmployee;
  pickedByHand: boolean;
  /** The department's status in the round (single_template: always `ready`). */
  departmentStatus: RoundDepartmentStatus;
  template: CandidateTemplate | null;
  signedBefore: SignedBefore | null;
  openElsewhere: OpenElsewhere | null;
  alreadySigned: AlreadySignedChoice;
  /** Today in Israel (`todayInIsrael()`), the day the values are built for. */
  sendDay: string;
  employerSignature: SavedEmployerSignature | null;
  font: TextFont;
  textFitCache?: TextFitCache;
}

/** No usable email: the reason, from the email status (never the address). */
export function noEmailReasonOf(employee: {
  emailStatus: EmailStatus;
  values: { email: string | null };
}): NoEmailReason | null {
  const hasEmail = (employee.values.email ?? '').trim() !== '';
  if (employee.emailStatus === 'valid') return hasEmail ? null : 'missing';
  return employee.emailStatus;
}

/** A box's Hebrew name for the warnings: the system value's name, else its label, else its key. */
export function boxName(fields: readonly FieldPosition[], key: string): string {
  const field = fields.find((position) => position.key === key);
  if (!field) return key;
  if (isSystemValueType(field.fieldType)) return SYSTEM_VALUE_NAMES[field.fieldType];
  if (field.fieldType === 'pension_fund_name') return PENSION_FUND_NAME_LABEL;
  return field.label ?? key;
}

/** One recipient → one outcome, with the values step (3.6) run against their template. */
export function resolveRecipient(input: ResolveRecipientInput): ResolvedRecipient {
  const { employee, template } = input;
  const result: ResolvedRecipient = {
    employee,
    pickedByHand: input.pickedByHand,
    template: null,
    outcome: 'inactive',
    signedBefore: input.signedBefore,
    openElsewhere: input.openElsewhere,
    missing: [],
    textWarnings: [],
    noEmailReason: null,
  };
  if (!employee.isActive) return result;
  if (input.departmentStatus !== 'ready' || !template) {
    result.outcome =
      input.departmentStatus === 'choice_needed' ? 'waiting_for_choice' : 'no_template';
    return result;
  }
  result.template = template;
  if (input.signedBefore && input.alreadySigned === 'skip') {
    result.outcome = 'already_signed';
    return result;
  }
  if (input.openElsewhere) {
    result.outcome = 'already_open';
    return result;
  }

  const { fieldValues, missing } = buildFieldValues({
    employee: employee.values,
    fields: template.fields,
    employerSignatureMode: template.row.employerSignatureMode,
    employerSignature: input.employerSignature,
    sendDay: input.sendDay,
  });
  const fit = checkTextFit(template.fields, fieldValues, input.font, input.textFitCache);
  const named = (keys: string[]) =>
    keys.map((key) => ({ key, name: boxName(template.fields, key) }));
  if (fit.tooLong.length > 0) {
    result.textWarnings.push({ code: 'TEXT_TOO_LONG', keys: named(fit.tooLong) });
  }
  if (fit.unsupported.length > 0) {
    result.textWarnings.push({ code: 'CHARACTERS_NOT_SUPPORTED', keys: named(fit.unsupported) });
  }
  result.missing = missing;
  result.noEmailReason = noEmailReasonOf(employee);
  if (missing.length > 0) result.outcome = 'missing_data';
  else if (result.noEmailReason) result.outcome = 'no_email';
  else result.outcome = 'email';
  return result;
}
