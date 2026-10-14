import { z } from 'zod';
import { userRoleSchema } from './enums.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A new staff password: 10–128 characters, any characters (Hebrew and spaces too), not trimmed.
 * Length only, no "must contain a digit or symbol" rules (NIST 800-63B). The cap keeps Argon2
 * fast; login accepts up to 1024 so it never refuses a password that was valid before.
 */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Staff emails are stored lowercase (login lowercases before lookup). */
const staffEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(255));

const fullNameSchema = z.string().trim().min(1).max(100);

/** `POST /api/users`. Unknown fields are refused. */
export const createUserSchema = z.strictObject({
  email: staffEmailSchema,
  fullName: fullNameSchema,
  role: userRoleSchema,
  password: passwordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * `PATCH /api/users/:id`: rename, change role, disable/enable, reset password; at least one.
 * The email can't be changed (it is the login); unknown fields, `email` included, are refused.
 */
export const updateUserSchema = z
  .strictObject({
    fullName: fullNameSchema.optional(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** A staff user as the API returns it. There is no password hash field, by design. */
export const staffUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type StaffUser = z.infer<typeof staffUserSchema>;
