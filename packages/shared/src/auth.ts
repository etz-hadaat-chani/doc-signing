import { z } from 'zod';
import { userRoleSchema } from './enums.js';

/**
 * Staff login body. The email is trimmed and lowercased before the format check, because staff
 * emails are stored lowercase. The password is capped so a huge value can't make Argon2 slow.
 * Failed checks use zod's default messages, which the API reports as INVALID_VALUE.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  password: z.string().min(1).max(1024),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** The signed-in staff user: the response of login and `GET /api/auth/me`. */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;
