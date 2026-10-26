import { z } from 'zod';
import { type EmailStatus, emailStatusSchema } from './enums.js';
import { idNumberSchema } from './id-number.js';
import { flagSchema, optionalQuery, pageQuerySchema } from './pagination.js';

export const EMPLOYEE_NUMBER_MAX_LENGTH = 20;
export const EMPLOYEE_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 255;
export const SEARCH_MAX_LENGTH = 100;

/**
 * Employee number (the import key) → digits with leading zeros removed, so "0123" typed by hand
 * and 123 from the Har Gal export (a number) are the same employee. Accepts a number because the
 * export sends one. Returns null for anything that isn't 1–20 digits, or is all zeros.
 */
export function normalizeEmployeeNumber(value: string | number): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    text = String(value);
  } else {
    text = value.trim();
  }
  if (!new RegExp(`^\\d{1,${EMPLOYEE_NUMBER_MAX_LENGTH}}$`).test(text)) return null;
  const number = text.replace(/^0+/, '');
  return number === '' ? null : number;
}

/** Valid employee number (text or number) → normalized text. */
export const employeeNumberSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const number = normalizeEmployeeNumber(value);
  if (number === null) {
    ctx.addIssue({ code: 'custom', message: 'INVALID_EMPLOYEE_NUMBER' });
    return z.NEVER;
  }
  return number;
});

/**
 * Israeli phone → `050-1234567` (mobile and 07x: 3-digit prefix, 10 digits) or `02-1234567`
 * (landline: 2-digit prefix, 9 digits). Spaces, hyphens and brackets are ignored, `+972` becomes
 * 0, and a missing leading 0 is put back (Excel sends the prefix 050 as the number 50). Returns
 * null when the text can't be read as a phone. Reference only; nothing is ever sent to it.
 */
export function normalizePhone(value: string): string | null {
  let digits = value.trim().replace(/[\s\-()]/g, '');
  if (digits.startsWith('+972')) digits = `0${digits.slice(4)}`;
  if (!/^\d+$/.test(digits)) return null;
  if (!digits.startsWith('0')) digits = `0${digits}`;
  if (/^0[57]\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (/^0[2-489]\d{7}$/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return null;
}

/** Trimmed and lowercased; empty or missing → null (no email). Format is not checked here. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? '';
  return email === '' ? null : email;
}

const emailFormatSchema = z.email();

/** Is the (normalized) email a valid address? */
export function isEmailFormat(email: string): boolean {
  return emailFormatSchema.safeParse(email).success;
}

/**
 * The email status after saving `newEmail` (PRD FR-EMP-4; the same rule for a manager's edit and
 * the import). Same email as stored (after trim + lowercase) → the stored status stays, so a
 * bounced email stays bounced; a different email → `valid`, or `invalid` if the format is wrong;
 * empty → `missing`. `stored` is null for a new employee.
 */
export function nextEmailStatus(
  stored: { email: string | null; emailStatus: EmailStatus } | null,
  newEmail: string | null | undefined,
): EmailStatus {
  const email = normalizeEmail(newEmail);
  if (email === null) return 'missing';
  if (stored && normalizeEmail(stored.email) === email) return stored.emailStatus;
  return isEmailFormat(email) ? 'valid' : 'invalid';
}

/** Search text: trimmed, runs of spaces made one, so "first  last" still matches. */
export function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

const nameSchema = z.string().trim().min(1).max(EMPLOYEE_NAME_MAX_LENGTH);

/**
 * Any text is accepted and stored trimmed and lowercased; a wrong format is saved with status
 * `invalid`, not refused (FR-EMP-4). Empty or null → no email.
 */
const emailInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH)
  .nullable()
  .transform((value) => normalizeEmail(value));

/** Stored as `050-1234567`; text that can't be read as a phone → INVALID_PHONE. Empty → none. */
const phoneInputSchema = z
  .string()
  .max(30)
  .nullable()
  .transform((value, ctx) => {
    if (value === null || value.trim() === '') return null;
    const phone = normalizePhone(value);
    if (phone === null) {
      ctx.addIssue({ code: 'custom', message: 'INVALID_PHONE' });
      return z.NEVER;
    }
    return phone;
  });

/**
 * The extra employee details (PRD FR-EMP-1, FR-EMP-7, §12). Optional everywhere; an import cell
 * that is empty never erases them (FR-EMP-4). Never in the list, URLs or emails (NFR-PRV-6).
 */
export const EMPLOYEE_EXTRA_FIELDS = [
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
export type EmployeeExtraField = (typeof EMPLOYEE_EXTRA_FIELDS)[number];

/** Text extras and their column length (PRD §12). */
export const EMPLOYEE_TEXT_MAX_LENGTH = {
  address: 150,
  city: 60,
  jobTitle: 100,
  employmentStatus: 50,
  workDays: 50,
  pensionFundA: 100,
  pensionFundB: 100,
  studyFund: 100,
} as const satisfies Partial<Record<EmployeeExtraField, number>>;
export type EmployeeTextField = keyof typeof EMPLOYEE_TEXT_MAX_LENGTH;

/** The extras as stored: dates as `YYYY-MM-DD` (a calendar day, no time zone), numbers as numbers. */
export interface EmployeeExtras {
  address: string | null;
  city: string | null;
  birthDate: string | null;
  jobTitle: string | null;
  employmentStatus: string | null;
  jobPercent: number | null;
  workDays: string | null;
  hoursBaseCode: number | null;
  pensionFundA: string | null;
  pensionFundB: string | null;
  studyFund: string | null;
}

/** The earliest birth date accepted: anything before is a typo. */
export const BIRTH_DATE_MIN = '1900-01-01';
/** `hours_base_code` is a smallint. */
export const HOURS_BASE_CODE_MAX = 32767;

/** Today's calendar day in Israel as `YYYY-MM-DD`, whatever the server's time zone. */
export function todayInIsrael(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A real `YYYY-MM-DD` birth date (already checked as a date) from 1900 up to `today`. */
export function isBirthDateAllowed(date: string, today: string): boolean {
  return date >= BIRTH_DATE_MIN && date <= today;
}

/**
 * Whole years from `birthDate` to `today` (both `YYYY-MM-DD`). Someone born on 29 February is a
 * year older on 1 March in a year with no 29 February.
 */
export function ageOn(birthDate: string, today: string): number {
  const [birthYear = 0, birthMonth = 0, birthDay = 0] = birthDate.split('-').map(Number);
  const [year = 0, month = 0, day = 0] = today.split('-').map(Number);
  const hadBirthday = month > birthMonth || (month === birthMonth && day >= birthDay);
  return year - birthYear - (hadBirthday ? 0 : 1);
}

/**
 * שעות עבודה in the Har Gal export is a code for the full-time base, not a number of hours.
 * Known codes → weekly hours of the base. Other codes (0 = not known yet, 2, …) are kept as they
 * are and shown as the code (PRD §14 open question).
 */
export const HOURS_BASE_CODES: Readonly<Record<number, number>> = { 1: 42, 3: 30, 4: 40 };

/** "42 שעות" for a known code, the code itself for an unknown one; null when there is none. */
export function hoursBaseLabel(code: number | null): string | null {
  if (code === null) return null;
  const hours = HOURS_BASE_CODES[code];
  return hours === undefined ? String(code) : `${hours} שעות`;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The rule for each extra value, without "empty": used by the API (below) and by the import for
 * every filled cell, so both apply the same rule.
 */
export const employeeExtraValueSchemas = {
  address: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.address),
  city: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.city),
  birthDate: z.iso
    .date({ message: 'INVALID_BIRTH_DATE' })
    .refine((date) => isBirthDateAllowed(date, todayInIsrael()), {
      message: 'INVALID_BIRTH_DATE',
    }),
  jobTitle: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.jobTitle),
  employmentStatus: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.employmentStatus),
  jobPercent: z.number().min(0).max(100).transform(roundTo2),
  workDays: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.workDays),
  hoursBaseCode: z.number().int().min(0).max(HOURS_BASE_CODE_MAX),
  pensionFundA: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.pensionFundA),
  pensionFundB: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.pensionFundB),
  studyFund: z.string().trim().min(1).max(EMPLOYEE_TEXT_MAX_LENGTH.studyFund),
} as const satisfies Record<EmployeeExtraField, z.ZodType>;

/** API text extra: trimmed; empty or null → none (clears it on an edit). */
function textInput(field: EmployeeTextField) {
  return z
    .string()
    .trim()
    .max(EMPLOYEE_TEXT_MAX_LENGTH[field])
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));
}

/**
 * Every extra field, optional: what create and edit accept besides the core fields. A date or
 * number extra takes its value rule, or null (clears it on an edit).
 */
const extraInputShape = {
  landline: phoneInputSchema.optional(),
  mobile: phoneInputSchema.optional(),
  address: textInput('address').optional(),
  city: textInput('city').optional(),
  birthDate: employeeExtraValueSchemas.birthDate.nullable().optional(),
  jobTitle: textInput('jobTitle').optional(),
  employmentStatus: textInput('employmentStatus').optional(),
  jobPercent: employeeExtraValueSchemas.jobPercent.nullable().optional(),
  workDays: textInput('workDays').optional(),
  hoursBaseCode: employeeExtraValueSchemas.hoursBaseCode.nullable().optional(),
  pensionFundA: textInput('pensionFundA').optional(),
  pensionFundB: textInput('pensionFundB').optional(),
  studyFund: textInput('studyFund').optional(),
};

/** `POST /api/employees` (manager). Unknown fields are refused. */
export const createEmployeeSchema = z.strictObject({
  employeeNumber: employeeNumberSchema,
  idNumber: idNumberSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  departmentId: z.uuid(),
  email: emailInputSchema.optional(),
  ...extraInputShape,
});
export type CreateEmployeeInput = z.output<typeof createEmployeeSchema>;

/**
 * `PATCH /api/employees/:id` (manager); at least one field. The employee number can't be changed
 * (it is the import key and part of the signed-file path): unknown fields, `employeeNumber`
 * included, are refused. `email: null` or `""` removes the email; the phones and the text extras
 * likewise; `null` removes a date or number extra.
 */
export const updateEmployeeSchema = z
  .strictObject({
    idNumber: idNumberSchema.optional(),
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    departmentId: z.uuid().optional(),
    email: emailInputSchema.optional(),
    isActive: z.boolean().optional(),
    ...extraInputShape,
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export type UpdateEmployeeInput = z.output<typeof updateEmployeeSchema>;

/** The employee list's filters, combined with AND: department, email status, active or not. */
const employeeFilterShape = {
  ...pageQuerySchema.shape,
  dept: optionalQuery(z.uuid()),
  emailStatus: optionalQuery(emailStatusSchema),
  active: optionalQuery(flagSchema),
};

/**
 * `GET /api/employees?dept=&emailStatus=&active=&page=&pageSize=`: filters and paging only.
 * Search text is never in a URL (it may be an ID number): it goes in the body of the search route.
 */
export const employeeListQuerySchema = z.strictObject(employeeFilterShape);

/** `POST /api/employees/search`: the same filters plus `q`. */
export const employeeSearchSchema = z.strictObject({
  ...employeeFilterShape,
  q: optionalQuery(
    z
      .string()
      .max(SEARCH_MAX_LENGTH)
      .transform(normalizeSearchText)
      .transform((value) => (value === '' ? undefined : value)),
  ),
});
export type EmployeeListQuery = z.output<typeof employeeSearchSchema>;

/** A department as the API returns it; shown as "code - name" (formatDepartment). */
export const departmentSchema = z.object({
  id: z.uuid(),
  code: z.number().int().positive(),
  name: z.string(),
  isActive: z.boolean(),
});
export type Department = z.infer<typeof departmentSchema>;

/** One row of the employee list. No ID number: it is shown only on the card. */
export const employeeListItemSchema = z.object({
  id: z.uuid(),
  employeeNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  department: departmentSchema.omit({ isActive: true }),
  email: z.string().nullable(),
  emailStatus: emailStatusSchema,
  isActive: z.boolean(),
});
export type EmployeeListItem = z.infer<typeof employeeListItemSchema>;

/**
 * The employee card: the list row plus ID number, phones, the extra details and dates. `age` is
 * worked out from `birthDate` (today in Israel), never stored; `hoursBaseLabel` from the code.
 * `idNumber` is left out for officers: it protects every signing link, and officers only follow
 * up (PRD §9).
 */
export const employeeCardSchema = employeeListItemSchema.extend({
  idNumber: z.string().optional(),
  landline: z.string().nullable(),
  mobile: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  birthDate: z.iso.date().nullable(),
  age: z.number().int().nullable(),
  jobTitle: z.string().nullable(),
  employmentStatus: z.string().nullable(),
  jobPercent: z.number().nullable(),
  workDays: z.string().nullable(),
  hoursBaseCode: z.number().int().nullable(),
  hoursBaseLabel: z.string().nullable(),
  pensionFundA: z.string().nullable(),
  pensionFundB: z.string().nullable(),
  studyFund: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type EmployeeCard = z.infer<typeof employeeCardSchema>;
