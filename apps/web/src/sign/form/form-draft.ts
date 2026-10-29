import {
  buildAnswersSchema,
  conditionMatches,
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  type EmailChoice,
  errorMessage,
  isErrorCode,
  type SignFormResult,
  TEMPLATE_FIELD_GROUPS,
  type TemplateFieldSettings,
} from '@doc-signing/shared';
import { parseDay } from './date-text';

/**
 * Her answers on B3 while she fills them in, in this screen's memory only (never the address,
 * storage, the data cache or a log). Dates are kept as typed (DD/MM/YYYY). `email: null` = not
 * touched yet, so the field shows the stored email (FR-SGN-9).
 */
export interface FormDraft {
  emailChoice: EmailChoice | null;
  email: string | null;
  answers: Record<string, string | boolean>;
  /** PNG data URLs of the drawing boxes. */
  drawings: Record<string, string>;
}

export const EMPTY_DRAFT: FormDraft = { emailChoice: null, email: null, answers: {}, drawings: {} };

/** The items errors of the email section belong to: the choice, and the address. */
export const EMAIL_CHOICE_ITEM = EMAIL_CHOICE_KEY;
export const EMAIL_ITEM = EMAIL_ANSWER_KEY;
/** The fit check measures the address under the email box's own key. */
export const EMAIL_FIT_KEY = 'email_input';

/** One thing on the form, in the template's order: a box, or the email section (once). */
export type FormItem = { kind: 'box'; box: TemplateFieldSettings } | { kind: 'email' };

export function formItems(fields: readonly TemplateFieldSettings[]): FormItem[] {
  const items: FormItem[] = [];
  let emailPlaced = false;
  for (const box of fields) {
    if (TEMPLATE_FIELD_GROUPS[box.fieldType] === 'email') {
      if (!emailPlaced) items.push({ kind: 'email' });
      emailPlaced = true;
    } else items.push({ kind: 'box', box });
  }
  return items;
}

const hasEmailSection = (form: SignFormResult) =>
  form.fields.some(({ fieldType }) => TEMPLATE_FIELD_GROUPS[fieldType] === 'email');

/** The address in the email box: what she typed, else the stored email. */
export function emailValue(form: SignFormResult, draft: FormDraft): string {
  return draft.email ?? form.emailPrefill ?? '';
}

/** Is this box shown for her answers now (FR-TPL-10)? The same rule as the server. */
export function isShown(box: TemplateFieldSettings, form: SignFormResult, draft: FormDraft) {
  return conditionMatches(box.showWhen, form.fields, draft);
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/**
 * The draft without the answers of boxes her answers now hide (a hidden box's answer is
 * dropped, FR-TPL-10). Conditions point only at boxes without a condition (FR-TPL-8), so one
 * pass is enough.
 */
export function withHiddenDropped(form: SignFormResult, draft: FormDraft): FormDraft {
  let { answers, drawings } = draft;
  for (const box of form.fields) {
    if (isShown(box, form, draft)) continue;
    if (box.key in answers) answers = without(answers, box.key);
    if (box.key in drawings) drawings = without(drawings, box.key);
  }
  return answers === draft.answers && drawings === draft.drawings
    ? draft
    : { ...draft, answers, drawings };
}

const asDay = (box: TemplateFieldSettings, text: string) =>
  box.fieldType === 'date_input' ? (parseDay(text) ?? text) : text;

/** The answers part of the submit body (3.13), as the shared schema takes it. */
export interface AnswersPart {
  emailChoice?: EmailChoice;
  email?: string;
  answers: Record<string, string | boolean>;
  drawings: Record<string, string>;
}

/**
 * What would be sent: shown boxes only, empty ones left out, dates as `YYYY-MM-DD`, the email
 * only with the "email" choice.
 */
export function answersOf(form: SignFormResult, draft: FormDraft): AnswersPart {
  const part: AnswersPart = { answers: {}, drawings: {} };
  if (hasEmailSection(form) && draft.emailChoice !== null) {
    part.emailChoice = draft.emailChoice;
    if (draft.emailChoice === 'email') part.email = emailValue(form, draft);
  }
  for (const item of formItems(form.fields)) {
    if (item.kind !== 'box' || !isShown(item.box, form, draft)) continue;
    const { key } = item.box;
    if (item.box.fieldType === 'drawing') {
      const image = draft.drawings[key];
      if (image) part.drawings[key] = image;
      continue;
    }
    const value = draft.answers[key];
    if (value === true) part.answers[key] = true;
    else if (typeof value === 'string' && value.trim() !== '') {
      part.answers[key] = asDay(item.box, value);
    }
  }
  return part;
}

/** Boxes whose text has a place in the document it must fit (FR-TPL-9). */
export function isFitChecked(box: TemplateFieldSettings): boolean {
  switch (box.fieldType) {
    case 'text':
    case 'long_text':
    case 'select':
    case 'date_input':
      return true;
    default:
      return TEMPLATE_FIELD_GROUPS[box.fieldType] === 'system';
  }
}

/** The text the fit check measures for a box: trimmed, a date as `YYYY-MM-DD`. */
export function fitTextOf(box: TemplateFieldSettings, value: string): string {
  return asDay(box, value).trim();
}

/** The item a fit key belongs to (the email is measured as `email_input`). */
export const fitItemKey = (key: string) => (key === EMAIL_FIT_KEY ? EMAIL_ITEM : key);

/** Each fit-checked item's text as it is now (shown boxes only). */
export function currentFitTexts(form: SignFormResult, draft: FormDraft): Map<string, string> {
  const texts = new Map<string, string>();
  if (hasEmailSection(form) && draft.emailChoice !== 'office') {
    texts.set(EMAIL_FIT_KEY, emailValue(form, draft).trim());
  }
  for (const item of formItems(form.fields)) {
    if (item.kind !== 'box' || !isFitChecked(item.box) || !isShown(item.box, form, draft)) {
      continue;
    }
    const value = draft.answers[item.box.key];
    if (typeof value === 'string') texts.set(item.box.key, fitTextOf(item.box, value));
  }
  return texts;
}

/** Fit results for texts she hasn't changed since: key → the text found too long. */
export function currentTooLong(
  form: SignFormResult,
  draft: FormDraft,
  tooLong: ReadonlyMap<string, string>,
): Set<string> {
  const texts = currentFitTexts(form, draft);
  const items = new Set<string>();
  for (const [key, text] of tooLong) {
    if (text !== '' && texts.get(key) === text) items.add(fitItemKey(key));
  }
  return items;
}

const messageOf = (code: string) => errorMessage(isErrorCode(code) ? code : 'INVALID_VALUE');

/**
 * Her answers checked with the server's own schema (`buildAnswersSchema`, 3.20): one Hebrew
 * message per item (a box key, `email_choice` or `email`). `tooLong` (key → the text the fit
 * check found too long) adds `ANSWER_DOES_NOT_FIT` while that text is unchanged.
 */
export function checkAnswers(
  form: SignFormResult,
  draft: FormDraft,
  tooLong: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const schema = buildAnswersSchema(form.fields, {
    signingDay: form.signingDay,
    leftForEmployee: form.leftForEmployee,
  });
  const errors = new Map<string, string>();
  const result = schema.safeParse(answersOf(form, draft));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const [first, second] = issue.path;
      const item =
        first === 'emailChoice' ? EMAIL_CHOICE_ITEM : first === 'email' ? EMAIL_ITEM : second;
      if (typeof item === 'string' && !errors.has(item)) errors.set(item, messageOf(issue.message));
    }
  }
  for (const item of currentTooLong(form, draft, tooLong)) {
    if (!errors.has(item)) errors.set(item, errorMessage('ANSWER_DOES_NOT_FIT'));
  }
  return errors;
}
