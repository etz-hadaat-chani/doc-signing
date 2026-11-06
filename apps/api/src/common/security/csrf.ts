import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppException } from '../errors/app.exception.js';

/** Methods that read only: never checked. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfRequest {
  method: string;
  /** The `Sec-Fetch-Site` header, if sent. */
  fetchSite: string | undefined;
  /** The `Origin` header, if sent. */
  origin: string | undefined;
}

/**
 * Whether a request may change something (CSRF, 7.2, Fetch Metadata + Origin):
 * - a read (GET, HEAD, OPTIONS) always may;
 * - a browser that sends `Sec-Fetch-Site` (every current one) may only from our own origin:
 *   `same-site` (another subdomain or port), `cross-site` and `none` are refused;
 * - else an `Origin` must be exactly the app's (`APP_PUBLIC_URL`); `null` and any other host,
 *   port or scheme are refused;
 * - neither header: not a browser page (a script, a test), which can't carry a victim's
 *   session anyway; it passes.
 * The session cookies are `SameSite=Strict` as well; this check doesn't rely on that alone.
 */
export function isCsrfAllowed(
  { method, fetchSite, origin }: CsrfRequest,
  appOrigin: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (fetchSite !== undefined) return fetchSite === 'same-origin';
  if (origin !== undefined) return origin === appOrigin;
  return true;
}

/**
 * The check as a middleware, before the body parsers (a refused body is never read) and before
 * routing. The refusal is a 403 `CSRF_REFUSED` through the error filter; nothing is logged (the
 * address of a signing route holds the link token, and bodies are never logged). `exemptPaths`:
 * server-to-server routes with no session cookie and their own proof (the email webhook's
 * signature).
 */
export function csrfProtection(publicUrl: string, exemptPaths: readonly string[] = []) {
  const appOrigin = new URL(publicUrl).origin;
  const exempt = (path: string) =>
    exemptPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (exempt(request.path)) {
      next();
      return;
    }
    const allowed = isCsrfAllowed(
      {
        method: request.method,
        fetchSite: request.get('Sec-Fetch-Site'),
        origin: request.get('Origin'),
      },
      appOrigin,
    );
    next(allowed ? undefined : new AppException('CSRF_REFUSED', HttpStatus.FORBIDDEN));
  };
}
