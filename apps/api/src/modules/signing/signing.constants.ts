import type { CookieOptions } from 'express';

/** The employee's signing-session cookie (3.13); never the staff cookie `sid`. */
export const SIGN_COOKIE = 'sign_sid';

/** Where every signing route lives; the cookie and the signing headers are limited to it. */
export const SIGN_PATH = '/api/sign';

/**
 * Signing-session cookie flags. Secure always (browsers accept it from http://localhost).
 * SameSite=Strict: the email link opens the web page, which needs no cookie; the page's own
 * requests (same site) set and send it. No maxAge: it ends when the browser closes (FR-SGN-8);
 * the server ends it after 15 minutes. Path /api/sign: no other route ever receives it.
 */
export function signCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'strict', path: SIGN_PATH };
}

/** The value kept of the browser's user agent (NFR-SIG-2), cut to a sane length. */
export const USER_AGENT_MAX_LENGTH = 512;

/** The office signing station's session cookie (3.16); never `sign_sid` or the staff `sid`. */
export const KIOSK_COOKIE = 'kiosk_sid';

/** Where every kiosk route lives; its cookie and the signing headers are limited to it. */
export const KIOSK_PATH = '/api/kiosk';

/** Like `signCookieOptions`, for the kiosk routes only (Path /api/kiosk). */
export function kioskCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'strict', path: KIOSK_PATH };
}
