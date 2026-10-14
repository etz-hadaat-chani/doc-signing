import { z } from 'zod';
import { type EmailStatus, emailStatusSchema } from './enums.js';
import { idNumberSchema } from './id-number.js';
import { optionalQuery, pageQuerySchema } from './pagination.js';

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

/** `POST /api/employees` (manager). Unknown fields are refused. */
export const createEmployeeSchema = z.strictObject({
  employeeNumber: employeeNumberSchema,
  idNumber: idNumberSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  departmentId: z.uuid(),
  email: emailInputSchema.optional(),
  phone: phoneInputSchema.optional(),
});
export type CreateEmployeeInput = z.output<typeof createEmployeeSchema>;

/**
 * `PATCH /api/employees/:id` (manager); at least one field. The employee number can't be changed
 * (it is the import key and part of the signed-file path): unknown fields, `employeeNumber`
 * included, are refused. `email: null` or `""` removes the email; `phone` likewise.
 */
export const updateEmployeeSchema = z
  .strictObject({
    idNumber: idNumberSchema.optional(),
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    departmentId: z.uuid().optional(),
    email: emailInputSchema.optional(),
    phone: phoneInputSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export type UpdateEmployeeInput = z.output<typeof updateEmployeeSchema>;

/** `GET /api/employees?q=&dept=&emailStatus=&page=&pageSize=`. Filters combine with AND. */
export const employeeListQuerySchema = pageQuerySchema.extend({
  q: optionalQuery(
    z
      .string()
      .max(SEARCH_MAX_LENGTH)
      .transform(normalizeSearchText)
      .transform((value) => (value === '' ? undefined : value)),
  ),
  dept: optionalQuery(z.uuid()),
  emailStatus: optionalQuery(emailStatusSchema),
});
export type EmployeeListQuery = z.output<typeof employeeListQuerySchema>;

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

/** The employee card: the list row plus ID number, phone and dates. */
export const employeeCardSchema = employeeListItemSchema.extend({
  idNumber: z.string(),
  phone: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type EmployeeCard = z.infer<typeof employeeCardSchema>;
