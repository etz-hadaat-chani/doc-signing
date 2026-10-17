import { z } from 'zod';
import {
  type EmployerSignatureMode,
  TEMPLATE_FIELD_TYPES,
  type TemplateFieldType,
  type TemplateFillMode,
  templateFillModeSchema,
} from './enums.js';

/**
 * What each field type is (FR-TPL-2). A Record, so a new type in the database fails to compile
 * until it is placed in a group here.
 * - `system_fixed`: a system value only the system fills in (FR-TPL-10: name, ID, employee number,
 *   age, document date; also the pension trio, whose empty value is a valid answer, FR-TPL-5).
 * - `system`: a system value that may also be filled in by the employee, per its fill mode.
 * - `email`: the email section (FR-SGN-9). The employee answers it; `email_input` is still
 *   pre-filled with the stored email, which she confirms or corrects.
 * - `box`: a box the employee fills in (FR-TPL-9).
 * - `signature`: the employee's or the employer's signature (FR-SGN-10, FR-TPL-7).
 */
export type TemplateFieldGroup = 'system_fixed' | 'system' | 'email' | 'box' | 'signature';

export const TEMPLATE_FIELD_GROUPS: Record<TemplateFieldType, TemplateFieldGroup> = {
  full_name: 'system_fixed',
  id_number: 'system_fixed',
  date: 'system_fixed',
  signature: 'signature',
  checkbox: 'box',
  text: 'box',
  employee_number: 'system_fixed',
  address: 'system',
  landline: 'system',
  mobile: 'system',
  age: 'system_fixed',
  job_title: 'system',
  employment_status: 'system',
  job_percent: 'system',
  work_days: 'system',
  study_fund: 'system',
  pension_has_fund: 'system_fixed',
  pension_no_fund: 'system_fixed',
  pension_fund_name: 'system_fixed',
  email_input: 'email',
  no_email_checkbox: 'email',
  long_text: 'box',
  select: 'box',
  date_input: 'box',
  drawing: 'box',
  employer_signature: 'signature',
};

export const PENSION_FIELD_TYPES = [
  'pension_has_fund',
  'pension_no_fund',
  'pension_fund_name',
] as const satisfies readonly TemplateFieldType[];

const isPension = (type: TemplateFieldType) =>
  (PENSION_FIELD_TYPES as readonly string[]).includes(type);

/** The fill modes a type may use; the first is the default (FR-TPL-10). Signatures: none. */
export function allowedFillModes(type: TemplateFieldType): readonly (TemplateFillMode | null)[] {
  switch (TEMPLATE_FIELD_GROUPS[type]) {
    case 'system_fixed':
      return ['system'];
    case 'system':
      return ['system', 'employee', 'system_then_employee'];
    case 'email':
    case 'box':
      return ['employee'];
    case 'signature':
      return [null];
  }
}

/** Boxes choose their own key; every other type uses its own name as its key. */
export const hasOwnKey = (type: TemplateFieldType) => TEMPLATE_FIELD_GROUPS[type] !== 'box';

/** The email section's answer, usable in a condition: `email` or `office` (FR-SGN-9). */
export const EMAIL_CHOICE_KEY = 'email_choice';
export const EMAIL_CHOICES = ['email', 'office'] as const;
export type EmailChoice = (typeof EMAIL_CHOICES)[number];

/** A key no box may take: a type's own name or the email choice. */
export function isReservedKey(key: string): boolean {
  return key === EMAIL_CHOICE_KEY || (TEMPLATE_FIELD_TYPES as readonly string[]).includes(key);
}

export const TEMPLATE_FIELD_KEY_MAX_LENGTH = 50;
export const TEMPLATE_FIELD_LABEL_MAX_LENGTH = 255;

/**
 * A box's identity inside its template (PRD §12): ASCII `[a-z][a-z0-9_]*`, up to 50. Any such
 * slug: keys are not a closed list, so custom employee details can add boxes later (PRD §4).
 */
export const templateFieldKeySchema = z
  .string()
  .max(TEMPLATE_FIELD_KEY_MAX_LENGTH, { message: 'TEMPLATE_FIELD_KEY_NOT_ALLOWED' })
  .regex(/^[a-z][a-z0-9_]*$/, { message: 'TEMPLATE_FIELD_KEY_NOT_ALLOWED' });

/** Text limits (FR-TPL-10): the cap and the default per kind of text box. */
export const TEXT_LIMITS = {
  text: { max: 500, default: 100 },
  long_text: { max: 2000, default: 1000 },
} as const;
/** A system value the employee may type in is one line, like short text. */
const SYSTEM_TEXT_LIMIT = TEXT_LIMITS.text;

export const SELECT_MIN_CHOICES = 2;
export const SELECT_MAX_CHOICES = 30;
export const SELECT_CHOICE_MAX_LENGTH = 100;
export const TEMPLATE_MAX_DRAWINGS = 5;

export const PENSION_SOURCES = ['a_then_b', 'b_only'] as const;
export type PensionSource = (typeof PENSION_SOURCES)[number];

/** The earliest or latest date of a date box: a fixed day or the signing day. */
export const SIGNING_DAY = 'signing_day';
const LIMIT_INVALID = { message: 'TEMPLATE_FIELD_LIMIT_INVALID' } as const;
const dateLimitSchema = z.union([z.literal(SIGNING_DAY, LIMIT_INVALID), z.iso.date(LIMIT_INVALID)]);

/** `template_fields.options` (FR-TPL-5, FR-TPL-10). Which keys a type may use: see below. */
export const templateFieldOptionsSchema = z.strictObject({
  pensionSource: z.enum(PENSION_SOURCES).optional(),
  maxLength: z.number().int(LIMIT_INVALID).min(1, LIMIT_INVALID).optional(),
  choices: z
    .array(z.string().trim().min(1, LIMIT_INVALID).max(SELECT_CHOICE_MAX_LENGTH, LIMIT_INVALID))
    .max(SELECT_MAX_CHOICES, LIMIT_INVALID)
    .optional(),
  minDate: dateLimitSchema.optional(),
  maxDate: dateLimitSchema.optional(),
});
export type TemplateFieldOptions = z.output<typeof templateFieldOptionsSchema>;

/** One condition (FR-TPL-10): shown only when the box `key` has the value `equals`. */
export const showWhenSchema = z.strictObject({
  key: templateFieldKeySchema,
  equals: z.string().trim().min(1).max(SELECT_CHOICE_MAX_LENGTH),
});
export type ShowWhen = z.output<typeof showWhenSchema>;

/** The settings a position may send; anything left out takes its type's default. */
export const templateFieldSettingsInputShape = {
  key: templateFieldKeySchema.optional(),
  fillMode: templateFillModeSchema.nullable().optional(),
  showWhen: showWhenSchema.nullable().optional(),
  options: templateFieldOptionsSchema.nullable().optional(),
  isRequired: z.boolean().optional(),
  label: z.string().trim().max(TEMPLATE_FIELD_LABEL_MAX_LENGTH).nullable().optional(),
  needsApproval: z.boolean().optional(),
};
type SettingsInput = { fieldType: TemplateFieldType } & {
  [K in keyof typeof templateFieldSettingsInputShape]?: z.output<
    (typeof templateFieldSettingsInputShape)[K]
  >;
};

/** A box's settings after defaults (as stored). Boxes sent without a key get one later. */
export interface TemplateFieldSettings {
  fieldType: TemplateFieldType;
  key: string;
  fillMode: TemplateFillMode | null;
  showWhen: ShowWhen | null;
  options: TemplateFieldOptions | null;
  isRequired: boolean;
  label: string | null;
  needsApproval: boolean;
}

/** May the employee give this box a value? (Her own box, or a system value she may fill in.) */
export function employeeMayFill(field: Pick<TemplateFieldSettings, 'fieldType' | 'fillMode'>) {
  return field.fillMode === 'employee' || field.fillMode === 'system_then_employee';
}

/** The text limit that applies to a type with this fill mode, or null when it takes none. */
function textLimitFor(type: TemplateFieldType, fillMode: TemplateFillMode | null) {
  if (type === 'text' || type === 'long_text') return TEXT_LIMITS[type];
  if (TEMPLATE_FIELD_GROUPS[type] === 'system' && fillMode !== 'system') return SYSTEM_TEXT_LIMIT;
  return null;
}

const effectiveFillMode = (field: SettingsInput) =>
  field.fillMode === undefined ? (allowedFillModes(field.fieldType)[0] ?? null) : field.fillMode;

/**
 * The rules one position's settings must follow (400 when broken): the fill mode its type
 * allows, the key its type allows, limits only on the types that use them and within their caps,
 * approval only on a box the employee may fill in. Each issue's message is its error code.
 * Rules that need the whole template (conditions, same key, pairs) are "ready" reasons instead.
 */
export function checkFieldSettings(field: SettingsInput, ctx: z.RefinementCtx): void {
  const { fieldType: type } = field;
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });

  if (field.fillMode !== undefined && !allowedFillModes(type).includes(field.fillMode)) {
    issue(['fillMode'], 'TEMPLATE_FIELD_FILL_MODE_NOT_ALLOWED');
  }
  if (field.key !== undefined) {
    const allowed = hasOwnKey(type) ? field.key === type : !isReservedKey(field.key);
    if (!allowed) issue(['key'], 'TEMPLATE_FIELD_KEY_NOT_ALLOWED');
  }
  const fillMode = effectiveFillMode(field);
  if (field.needsApproval && !employeeMayFill({ fieldType: type, fillMode })) {
    issue(['needsApproval'], 'TEMPLATE_FIELD_OPTION_NOT_ALLOWED');
  }

  const options = field.options ?? {};
  const textLimit = textLimitFor(type, fillMode);
  const allowedOptions: Record<keyof TemplateFieldOptions, boolean> = {
    pensionSource: isPension(type),
    maxLength: textLimit !== null,
    choices: type === 'select',
    minDate: type === 'date_input',
    maxDate: type === 'date_input',
  };
  for (const name of Object.keys(options) as (keyof TemplateFieldOptions)[]) {
    if (options[name] !== undefined && !allowedOptions[name]) {
      issue(['options', name], 'TEMPLATE_FIELD_OPTION_NOT_ALLOWED');
    }
  }
  if (textLimit && options.maxLength !== undefined && options.maxLength > textLimit.max) {
    issue(['options', 'maxLength'], 'TEMPLATE_FIELD_LIMIT_INVALID');
  }
  if (options.choices && new Set(options.choices).size !== options.choices.length) {
    issue(['options', 'choices'], 'TEMPLATE_FIELD_LIMIT_INVALID');
  }
}

/** The stored `options` for a type: its limits with defaults written in, or null. */
function optionsWithDefaults(
  type: TemplateFieldType,
  fillMode: TemplateFillMode | null,
  given: TemplateFieldOptions,
): TemplateFieldOptions | null {
  if (isPension(type)) return { pensionSource: given.pensionSource ?? 'a_then_b' };
  const textLimit = textLimitFor(type, fillMode);
  if (textLimit) return { maxLength: given.maxLength ?? textLimit.default };
  if (type === 'select') return { choices: given.choices ?? [] };
  if (type === 'date_input') {
    const dates: TemplateFieldOptions = {
      ...(given.minDate !== undefined && { minDate: given.minDate }),
      ...(given.maxDate !== undefined && { maxDate: given.maxDate }),
    };
    return Object.keys(dates).length > 0 ? dates : null;
  }
  return null;
}

/**
 * The settings with every default filled in (call after `checkFieldSettings` passed). `key` stays
 * null for a box sent without one; `assignBoxKeys` gives it one with the whole list in view.
 */
export function withFieldDefaults<T extends SettingsInput>(
  field: T,
): Omit<T, keyof TemplateFieldSettings> &
  Omit<TemplateFieldSettings, 'key'> & { key: string | null } {
  const fillMode = effectiveFillMode(field);
  const label = field.label ?? null;
  return {
    ...field,
    key: field.key ?? (hasOwnKey(field.fieldType) ? field.fieldType : null),
    fillMode,
    showWhen: field.showWhen ?? null,
    options: optionsWithDefaults(field.fieldType, fillMode, field.options ?? {}),
    isRequired: field.isRequired ?? true,
    label: label === '' ? null : label,
    needsApproval: field.needsApproval ?? false,
  };
}

/**
 * Gives each box sent without a key the next free `box_<n>`: n counts on from the highest
 * `box_<number>` in the list (numbers up to 9 digits), skipping any key already used, so keys
 * already in use never change.
 */
export function assignBoxKeys<T extends { key: string | null }>(
  fields: readonly T[],
): (T & { key: string })[] {
  const used = new Set<string>();
  let n = 0;
  for (const { key } of fields) {
    if (key === null) continue;
    used.add(key);
    const match = /^box_(\d{1,9})$/.exec(key);
    if (match) n = Math.max(n, Number(match[1]));
  }
  const nextKey = () => {
    do n += 1;
    while (used.has(`box_${n}`));
    return `box_${n}`;
  };
  return fields.map((field) => ({ ...field, key: field.key ?? nextKey() }));
}

/**
 * Why a template can't be used in a round yet (FR-TPL-8), each with the Hebrew text the template
 * screen shows. The list order is the order the reasons are reported in.
 */
export const TEMPLATE_NOT_READY_MESSAGES = {
  NO_MAIN_SIGNATURE: 'חסר מיקום לחתימת העובד שמוצג תמיד (ללא תנאי)',
  EMAIL_SECTION_INCOMPLETE:
    'באזור האימייל חייבים להופיע יחד תיבת האימייל ותיבת הסימון "אין לי אימייל"',
  PENSION_INCOMPLETE: 'בקרן הפנסיה חייבים להופיע יחד "יש קרן פעילה" ו"אין קרן פעילה"',
  PENSION_SOURCE_MISMATCH: 'כל שדות קרן הפנסיה חייבים להשתמש באותו מקור (א ואז ב, או ב בלבד)',
  EMPLOYER_SIGNATURE_MISSING: 'נבחרה חתימת מעסיק, אבל אין בתבנית מיקום לחתימת המעסיק',
  LABEL_MISSING: 'לכל תיבה שהעובד ממלא חייבת להיות כותרת בעברית',
  TOO_FEW_CHOICES: 'ברשימת בחירה חייבות להיות לפחות 2 אפשרויות',
  CONDITION_KEY_MISSING: 'תנאי מפנה לתיבה שאינה קיימת בתבנית',
  CONDITION_TARGET_TYPE: 'תנאי יכול להפנות רק לתיבת סימון, לרשימת בחירה או לבחירת האימייל',
  CONDITION_TARGET_HAS_CONDITION: 'תנאי מפנה לתיבה שיש לה תנאי משלה',
  CONDITION_VALUE_INVALID: 'תנאי מפנה לערך שהתיבה לא יכולה לקבל',
  KEY_SETTINGS_MISMATCH: 'מיקומים עם אותו מפתח חייבים להיות מאותו סוג ועם אותן הגדרות',
  DATE_RANGE_INVALID: 'התאריך המוקדם ביותר מאוחר מהתאריך המאוחר ביותר',
  TOO_MANY_DRAWINGS: 'בתבנית יכולות להיות עד 5 תיבות ציור',
} as const;
export type TemplateNotReadyCode = keyof typeof TEMPLATE_NOT_READY_MESSAGES;
export const TEMPLATE_NOT_READY_CODES = Object.keys(
  TEMPLATE_NOT_READY_MESSAGES,
) as TemplateNotReadyCode[];

/** One reason, with the keys of the boxes involved (never a value). */
export interface TemplateNotReadyReason {
  code: TemplateNotReadyCode;
  message: string;
  keys: string[];
}

/** JSON with sorted object keys, so equal settings give the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * What must be the same on every position of one key. A signature's condition is per position:
 * one drawing, some lines shown always and some only under a condition (FR-SGN-10).
 */
function boxSettings(field: TemplateFieldSettings): string {
  const { fieldType, fillMode, options, isRequired, label, needsApproval, showWhen } = field;
  const perPosition = TEMPLATE_FIELD_GROUPS[fieldType] === 'signature';
  return canonical({
    fieldType,
    fillMode,
    options,
    isRequired,
    label,
    needsApproval,
    showWhen: perPosition ? null : showWhen,
  });
}

/** The values a condition may test on its target, or null when the target can't be tested. */
function conditionValues(target: TemplateFieldSettings): readonly string[] | null {
  if (target.fieldType === 'checkbox') return ['true', 'false'];
  if (target.fieldType === 'select') return target.options?.choices ?? [];
  return null;
}

/**
 * The "template ready" check (FR-TPL-8): every reason the template can't be used in a round,
 * or an empty list when it can. Saving never waits for this; rounds refuse a template that
 * isn't ready (3.8, 3.9).
 */
export function templateReadiness(template: {
  employerSignatureMode: EmployerSignatureMode;
  fields: readonly TemplateFieldSettings[];
}): TemplateNotReadyReason[] {
  const { fields } = template;
  const found = new Map<TemplateNotReadyCode, string[]>();
  const add = (code: TemplateNotReadyCode, ...keys: string[]) => {
    const list = found.get(code) ?? [];
    for (const key of keys) if (!list.includes(key)) list.push(key);
    found.set(code, list);
  };
  const has = (type: TemplateFieldType) => fields.some(({ fieldType }) => fieldType === type);
  const keysOf = (...types: TemplateFieldType[]) =>
    fields.filter(({ fieldType }) => types.includes(fieldType)).map(({ key }) => key);

  // One entry per key: its first position stands for the box.
  const boxes = new Map<string, TemplateFieldSettings>();
  for (const field of fields) {
    const first = boxes.get(field.key);
    if (!first) boxes.set(field.key, field);
    else if (boxSettings(first) !== boxSettings(field)) add('KEY_SETTINGS_MISMATCH', field.key);
  }

  if (!fields.some(({ fieldType, showWhen }) => fieldType === 'signature' && showWhen === null)) {
    add('NO_MAIN_SIGNATURE');
  }
  const hasEmailSection = has('email_input') && has('no_email_checkbox');
  if (has('email_input') !== has('no_email_checkbox')) {
    add('EMAIL_SECTION_INCOMPLETE', ...keysOf('email_input', 'no_email_checkbox'));
  }
  if (has('pension_has_fund') !== has('pension_no_fund')) {
    add('PENSION_INCOMPLETE', ...keysOf('pension_has_fund', 'pension_no_fund'));
  }
  const pension = fields.filter(({ fieldType }) => isPension(fieldType));
  if (new Set(pension.map(({ options }) => options?.pensionSource)).size > 1) {
    add('PENSION_SOURCE_MISMATCH', ...pension.map(({ key }) => key));
  }
  if (template.employerSignatureMode !== 'none' && !has('employer_signature')) {
    add('EMPLOYER_SIGNATURE_MISSING');
  }

  let drawings = 0;
  for (const box of boxes.values()) {
    const { key, fieldType, options } = box;
    // The email section's text is fixed by the system (FR-SGN-9), so it needs no label.
    if (employeeMayFill(box) && TEMPLATE_FIELD_GROUPS[fieldType] !== 'email' && !box.label) {
      add('LABEL_MISSING', key);
    }
    if (fieldType === 'select' && (options?.choices?.length ?? 0) < SELECT_MIN_CHOICES) {
      add('TOO_FEW_CHOICES', key);
    }
    const { minDate, maxDate } = options ?? {};
    const fixed = (date: string | undefined) => date !== undefined && date !== SIGNING_DAY;
    if (fixed(minDate) && fixed(maxDate) && (minDate ?? '') > (maxDate ?? '')) {
      add('DATE_RANGE_INVALID', key);
    }
    if (fieldType === 'drawing') drawings += 1;
  }
  if (drawings > TEMPLATE_MAX_DRAWINGS) add('TOO_MANY_DRAWINGS', ...keysOf('drawing'));

  for (const { key, showWhen } of fields) {
    if (!showWhen) continue;
    if (showWhen.key === EMAIL_CHOICE_KEY) {
      if (!hasEmailSection) add('CONDITION_KEY_MISSING', key);
      else if (!(EMAIL_CHOICES as readonly string[]).includes(showWhen.equals)) {
        add('CONDITION_VALUE_INVALID', key);
      }
      continue;
    }
    const target = boxes.get(showWhen.key);
    const values = target ? conditionValues(target) : null;
    if (!target) add('CONDITION_KEY_MISSING', key);
    else if (!values) add('CONDITION_TARGET_TYPE', key);
    else if (target.showWhen) add('CONDITION_TARGET_HAS_CONDITION', key);
    else if (!values.includes(showWhen.equals)) add('CONDITION_VALUE_INVALID', key);
  }

  return TEMPLATE_NOT_READY_CODES.filter((code) => found.has(code)).map((code) => ({
    code,
    message: TEMPLATE_NOT_READY_MESSAGES[code],
    keys: found.get(code) ?? [],
  }));
}
