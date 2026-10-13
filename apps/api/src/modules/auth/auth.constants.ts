import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';

/** Name of the staff session cookie. */
export const SESSION_COOKIE = 'sid';

/** A session ends after this long without a request (PRD NFR-SEC-6). */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** A session ends this long after login, however active it is. */
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** `last_used_at` is written at most this often, so not every request is a database write. */
export const TOUCH_INTERVAL_MS = 60 * 1000;

/** Failed-login limit: attempts per email and per IP within the window → 429. */
export const MAX_ATTEMPTS_PER_EMAIL = 5;
export const MAX_ATTEMPTS_PER_IP = 20;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** 256 random bits, base64url (43 characters). Goes only into the cookie, never the database. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database stores instead of the token: SHA-256, lowercase hex. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A cookie value that could be a session token; anything else is refused without a query. */
export function isSessionTokenShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Session cookie flags. Secure is always on, in every environment, so production can't run
 * without it; browsers accept Secure cookies from http://localhost. No maxAge or expires: the
 * cookie ends when the browser closes (shared computers); the server enforces both time limits.
 * Path /api: only API calls carry it.
 */
export function sessionCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'strict', path: '/api' };
}
