import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../../common/errors/app.exception.js';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.constants.js';
import { type SessionAuth, SessionService } from './session.service.js';

/** A request after SessionGuard: `auth` holds the session and the signed-in user. */
export type AuthRequest = Request & { auth?: SessionAuth };

/** The session cookie's value, if any (cookie-parser types cookies as `any`). */
export function sessionCookie(request: Request): unknown {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  return (cookies as Record<string, unknown>)[SESSION_COOKIE];
}

/**
 * Lets a request through only with a valid staff session (user still active), and puts it on
 * `request.auth`. Otherwise clears the cookie and answers 401. Task 2.3 builds the global
 * default-deny guard on the same check.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthRequest>();
    const auth = await this.sessions.authenticate(sessionCookie(request));
    if (!auth) {
      http.getResponse<Response>().clearCookie(SESSION_COOKIE, sessionCookieOptions());
      throw new AppException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    request.auth = auth;
    return true;
  }
}
