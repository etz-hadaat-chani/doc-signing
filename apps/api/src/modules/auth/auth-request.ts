import type { Request } from 'express';
import { SESSION_COOKIE } from './auth.constants.js';
import type { SessionAuth } from './session.service.js';

/** A request after AccessGuard: on a @Roles route, `auth` holds the session and the user. */
export type AuthRequest = Request & { auth?: SessionAuth };

/** The session cookie's value, if any (cookie-parser types cookies as `any`). */
export function sessionCookie(request: Request): unknown {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  return (cookies as Record<string, unknown>)[SESSION_COOKIE];
}
