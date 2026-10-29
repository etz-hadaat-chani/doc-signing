import {
  type CreateUserInput,
  createUserSchema,
  errorMessage,
  fieldErrorSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  type StaffUser,
  type UserRole,
} from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';

/**
 * The staff-user forms (A12, FR-ADM-1): add a user, reset a password. The shared schemas (the
 * server's rules) check the values; this only names each problem in Hebrew next to its field.
 */

export interface NewUserValues {
  fullName: string;
  email: string;
  role: UserRole;
  password: string;
}

export const NEW_USER_FIELDS = ['fullName', 'email', 'password'] as const;
export type NewUserField = (typeof NEW_USER_FIELDS)[number];
export type NewUserErrors = Partial<Record<NewUserField, string>>;

const errors = he.users.errors;
const passwordLength = errors.passwordLength(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH);

export function emptyNewUser(): NewUserValues {
  return { fullName: '', email: '', role: 'officer', password: '' };
}

function issueText(field: NewUserField, issue: z.core.$ZodIssue): string {
  if (field === 'password') return passwordLength;
  if (field === 'email') return issue.code === 'too_small' ? errors.required : errors.emailInvalid;
  if (issue.code === 'too_big' && typeof issue.maximum === 'number') {
    return errors.tooLong(Number(issue.maximum));
  }
  return errors.required;
}

const isField = (value: unknown): value is NewUserField =>
  NEW_USER_FIELDS.some((field) => field === value);

/** Checks the whole new user; `input` is null while any field has a problem. */
export function checkNewUser(values: NewUserValues): {
  input: CreateUserInput | null;
  errors: NewUserErrors;
} {
  const found: NewUserErrors = {};
  if (values.email.trim() === '') found.email = errors.required;
  const result = createUserSchema.safeParse(values);
  if (result.success) return { input: result.data, errors: found };
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (isField(field) && found[field] === undefined) found[field] = issueText(field, issue);
  }
  return { input: null, errors: found };
}

/** A new password (reset): 10–128 characters, nothing else; never trimmed. */
export function checkPassword(password: string): string | null {
  return passwordSchema.safeParse(password).success ? null : passwordLength;
}

/**
 * A refused save → the fields to mark, with our own Hebrew (never text from the response).
 * Null when the error belongs to no field (shown as a notification).
 */
export function serverUserErrors(error: unknown): NewUserErrors | null {
  if (!isApiRequestError(error) || error.code === null) return null;
  if (error.code === 'EMAIL_TAKEN') return { email: error.message };
  if (error.code !== 'VALIDATION_FAILED') return null;
  const parsed = z.array(fieldErrorSchema).safeParse(error.details?.fields);
  if (!parsed.success) return null;
  const found: NewUserErrors = {};
  for (const item of parsed.data) {
    const field = item.field.split('.')[0];
    if (isField(field) && found[field] === undefined) {
      found[field] = field === 'password' ? passwordLength : errorMessage(item.code);
    }
  }
  return Object.keys(found).length === 0 ? null : found;
}

/**
 * The buttons a row gets. The acting manager's own row has no "disable" and no "make officer"
 * (the server refuses them anyway, 409 `CANNOT_CHANGE_OWN_ACCESS`); a password reset is allowed.
 */
export function userActions(row: StaffUser, actorId: string) {
  const own = row.id === actorId;
  return {
    makeManager: row.role === 'officer',
    makeOfficer: row.role === 'manager' && !own,
    disable: row.isActive && !own,
    enable: !row.isActive,
    resetPassword: true,
  };
}
