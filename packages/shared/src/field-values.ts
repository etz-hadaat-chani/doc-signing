import { z } from 'zod';
import type { TemplateFieldType } from './enums.js';
import { templateFieldKeySchema } from './template-fields.js';

/**
 * The system values a template can show as text (FR-TPL-2), with the Hebrew name used when one is
 * missing or left for the employee (field names only, never the value). Not the document date
 * (drawn as the view or signing day) and not the pension trio (never missing, FR-TPL-5).
 */
export const SYSTEM_VALUE_NAMES = {
  full_name: 'שם מלא',
  id_number: 'תעודת זהות',
  employee_number: 'מספר עובד',
  address: 'כתובת',
  landline: 'טלפון',
  mobile: 'טלפון נייד',
  age: 'גיל',
  job_title: 'תפקיד',
  employment_status: 'מעמד',
  job_percent: 'אחוז משרה',
  work_days: 'ימי עבודה',
  study_fund: 'קרן השתלמות',
} as const satisfies Partial<Record<TemplateFieldType, string>>;
export type SystemValueType = keyof typeof SYSTEM_VALUE_NAMES;

export function isSystemValueType(type: TemplateFieldType): type is SystemValueType {
  return Object.hasOwn(SYSTEM_VALUE_NAMES, type);
}

/** The name shown when a required value is missing: it says what to fix in the employee card. */
export function missingValueName(type: SystemValueType): string {
  return type === 'age' ? 'גיל (חסר תאריך לידה)' : SYSTEM_VALUE_NAMES[type];
}

/** The employer signature image a document uses (3.18 setting, saved at send). */
export const savedEmployerSignatureSchema = z.strictObject({
  fileKey: z.string().min(1),
  width: z.int().positive(),
  height: z.int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SavedEmployerSignature = z.infer<typeof savedEmployerSignatureSchema>;

/**
 * The values filled into a document (FR-RND-8): built by the values step, saved at send as
 * `assignments.field_values` (3.10) and drawn from then on, so a later import never changes a
 * document already sent. Plain JSON. `values` is keyed by box key, only the keys the template uses:
 * text as drawn ("50%", 9-digit ID), the pension ticks as booleans, `email_input` = the stored
 * email as the form's pre-fill (FR-SGN-9). An empty value is "". The document date is not here: it
 * is the view day or the signing day. Personal data: never logged (NFR-PRV-7).
 */
export const fieldValuesSchema = z.strictObject({
  version: z.literal(1),
  /** The day the values were built (Asia/Jerusalem), `YYYY-MM-DD`; the age is on this day. */
  sendDay: z.iso.date(),
  values: z.record(templateFieldKeySchema, z.union([z.string(), z.boolean()])),
  /** Set when the template's mode is `pre_signed` or `after_employee` and an image exists. */
  employerSignature: savedEmployerSignatureSchema.nullable(),
});
export type FieldValues = z.infer<typeof fieldValuesSchema>;

/** `YYYY-MM-DD` → `DD/MM/YYYY` (NFR-HEB-1). */
export function formatDayIL(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}
