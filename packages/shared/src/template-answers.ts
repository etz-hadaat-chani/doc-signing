import { z } from 'zod';
import { isEmailFormat, normalizeEmail } from './employees.js';
import {
  EMAIL_CHOICE_KEY,
  EMAIL_CHOICES,
  type EmailChoice,
  employeeMayFill,
  SIGNING_DAY,
  TEMPLATE_FIELD_GROUPS,
  type TemplateFieldSettings,
} from './template-fields.js';

/** FR-SGN-9: an email the employee types is at most 254 characters. */
export const ANSWER_EMAIL_MAX_LENGTH = 254;

/** What the answers are checked against, besides the template's boxes. */
export interface AnswersContext {
  /** The signing day, `YYYY-MM-DD` in Asia/Jerusalem: the value of `signing_day` date limits. */
  signingDay: string;
  /**
   * Keys of `system_then_employee` boxes whose saved value (FR-RND-8) is empty, so the employee
   * fills them in. The others are not asked.
   */
  leftForEmployee?: readonly string[];
}

/** The checked answers: only boxes that are shown, trimmed; hidden boxes are not kept. */
export interface TemplateAnswers {
  emailChoice: EmailChoice | null;
  /** Only when the choice is `email`. Never written over the employee's stored email. */
  email: string | null;
  answers: Record<string, string | boolean>;
  /** PNG images, base64; their content is checked when the signed PDF is built (3.7). */
  drawings: Record<string, string>;
}

type AnswerKind = 'line' | 'long_text' | 'select' | 'date' | 'checkbox' | 'drawing';

function kindOf(box: TemplateFieldSettings, leftForEmployee: readonly string[]): AnswerKind | null {
  switch (box.fieldType) {
    case 'text':
      return 'line';
    case 'long_text':
      return 'long_text';
    case 'select':
      return 'select';
    case 'date_input':
      return 'date';
    case 'checkbox':
      return 'checkbox';
    case 'drawing':
      return 'drawing';
    default:
      break;
  }
  if (TEMPLATE_FIELD_GROUPS[box.fieldType] !== 'system' || !employeeMayFill(box)) return null;
  if (box.fillMode === 'employee' || leftForEmployee.includes(box.key)) return 'line';
  return null;
}

const answersInputSchema = z.strictObject({
  emailChoice: z.enum(EMAIL_CHOICES).optional(),
  email: z.string().optional(),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  drawings: z.record(z.string(), z.string()).optional(),
});
type AnswersInput = z.output<typeof answersInputSchema>;

/**
 * Builds the zod schema for a template's answers from its boxes (FR-TPL-10, FR-SGN-4, FR-SGN-9),
 * so the signing screen (3.13) and the server (6.4) check them with the same rules. Expects a
 * template that passed `templateReadiness`. Rules:
 * - A box whose condition doesn't match is hidden: never required and never kept. Left empty
 *   (missing, `""` or `false`) it is fine; a real value is refused (the form drops it first).
 * - Required: text not empty, checkbox ticked, drawing drawn. Optional and empty: not kept.
 * - Text within its `maxLength` (short text and system values one line); a list value one of its
 *   options; a date a real `YYYY-MM-DD` within its limits (`signing_day` = `context.signingDay`).
 * - Email section: exactly one choice; `email` needs a valid address up to 254 characters.
 * - An answer for a box that isn't asked is refused. Each issue's message is its error code.
 */
export function buildAnswersSchema(
  fields: readonly TemplateFieldSettings[],
  context: AnswersContext,
): z.ZodType<TemplateAnswers, unknown> {
  const boxes = new Map<string, TemplateFieldSettings>();
  for (const field of fields) if (!boxes.has(field.key)) boxes.set(field.key, field);
  const asked = new Map<string, { box: TemplateFieldSettings; kind: AnswerKind }>();
  for (const box of boxes.values()) {
    const kind = kindOf(box, context.leftForEmployee ?? []);
    if (kind) asked.set(box.key, { box, kind });
  }
  const hasEmailSection = [...boxes.values()].some(({ fieldType }) => fieldType === 'email_input');

  const isShown = (box: TemplateFieldSettings, input: AnswersInput): boolean => {
    const condition = box.showWhen;
    if (!condition) return true;
    if (condition.key === EMAIL_CHOICE_KEY) return input.emailChoice === condition.equals;
    const target = boxes.get(condition.key);
    const value = input.answers?.[condition.key];
    if (target?.fieldType === 'checkbox') return String(value === true) === condition.equals;
    return typeof value === 'string' && value.trim() === condition.equals;
  };
  const dateLimit = (limit: string | undefined) =>
    limit === SIGNING_DAY ? context.signingDay : limit;

  return answersInputSchema.transform((input, ctx): TemplateAnswers => {
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message, input });
    const result: TemplateAnswers = { emailChoice: null, email: null, answers: {}, drawings: {} };

    if (!hasEmailSection) {
      if (input.emailChoice !== undefined) issue(['emailChoice'], 'ANSWER_UNKNOWN_BOX');
      if (input.email !== undefined) issue(['email'], 'ANSWER_UNKNOWN_BOX');
    } else if (input.emailChoice === undefined) {
      issue(['emailChoice'], 'EMAIL_CHOICE_REQUIRED');
    } else {
      result.emailChoice = input.emailChoice;
      if (input.emailChoice === 'email') {
        const email = normalizeEmail(input.email);
        if (email === null) issue(['email'], 'ANSWER_REQUIRED');
        else if (email.length > ANSWER_EMAIL_MAX_LENGTH || !isEmailFormat(email)) {
          issue(['email'], 'INVALID_EMAIL');
        } else result.email = email;
      }
    }

    for (const key of Object.keys(input.answers ?? {})) {
      const kind = asked.get(key)?.kind;
      if (kind === undefined || kind === 'drawing') issue(['answers', key], 'ANSWER_UNKNOWN_BOX');
    }
    for (const key of Object.keys(input.drawings ?? {})) {
      if (asked.get(key)?.kind !== 'drawing') issue(['drawings', key], 'ANSWER_UNKNOWN_BOX');
    }

    for (const [key, { box, kind }] of asked) {
      if (!isShown(box, input)) {
        const given = kind === 'drawing' ? input.drawings?.[key] : input.answers?.[key];
        const hasValue = given === true || (typeof given === 'string' && given.trim() !== '');
        if (hasValue)
          issue([kind === 'drawing' ? 'drawings' : 'answers', key], 'ANSWER_BOX_HIDDEN');
        continue;
      }
      if (kind === 'drawing') {
        const image = input.drawings?.[key] ?? '';
        if (image !== '') result.drawings[key] = image;
        else if (box.isRequired) issue(['drawings', key], 'ANSWER_REQUIRED');
        continue;
      }
      const raw = input.answers?.[key];
      const path = ['answers', key];
      if (kind === 'checkbox') {
        if (raw !== undefined && typeof raw !== 'boolean') issue(path, 'INVALID_VALUE');
        else if (box.isRequired && raw !== true) issue(path, 'ANSWER_REQUIRED');
        else result.answers[key] = raw === true;
        continue;
      }
      if (typeof raw === 'boolean') {
        issue(path, 'INVALID_VALUE');
        continue;
      }
      const value = (raw ?? '').trim();
      if (value === '') {
        if (box.isRequired) issue(path, 'ANSWER_REQUIRED');
        continue;
      }
      const { maxLength, choices, minDate, maxDate } = box.options ?? {};
      if (kind === 'line' && /[\r\n]/.test(value)) issue(path, 'INVALID_VALUE');
      else if (maxLength !== undefined && value.length > maxLength) issue(path, 'ANSWER_TOO_LONG');
      else if (kind === 'select' && !(choices ?? []).includes(value)) {
        issue(path, 'ANSWER_NOT_A_CHOICE');
      } else if (kind === 'date' && !z.iso.date().safeParse(value).success) {
        issue(path, 'ANSWER_DATE_INVALID');
      } else if (
        kind === 'date' &&
        (value < (dateLimit(minDate) ?? value) || value > (dateLimit(maxDate) ?? value))
      ) {
        issue(path, 'ANSWER_DATE_OUT_OF_RANGE');
      } else result.answers[key] = value;
    }
    return result;
  });
}
