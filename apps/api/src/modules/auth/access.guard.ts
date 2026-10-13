import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AppException } from '../../common/errors/app.exception.js';
import { readAccessMetadata, resolveAccess } from './access.decorators.js';
import { type AuthRequest, sessionCookie } from './auth-request.js';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.constants.js';
import { SessionService } from './session.service.js';

/**
 * The one global guard (APP_GUARD), default deny:
 * - @Public() → allowed without a session.
 * - @Roles(...) → a valid staff session (else 401, cookie cleared), then a listed role (else 403).
 * - Neither → 403 for everyone, so a forgotten decorator never opens a route.
 * The session is checked only here, once per request, and put on `request.auth` (@CurrentUser).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const get = (key: string, target: object): unknown =>
      this.reflector.get<unknown>(key, target as () => void);
    const handler = context.getHandler();
    const controller = context.getClass();
    const access = resolveAccess(
      readAccessMetadata(get, handler),
      readAccessMetadata(get, controller),
    );

    if (access.kind === 'public') return true;
    if (access.kind === 'none') {
      this.logger.error(`${controller.name}.${handler.name} has neither @Public nor @Roles`);
      throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuthRequest>();
    const auth = await this.sessions.authenticate(sessionCookie(request));
    if (!auth) {
      http.getResponse<Response>().clearCookie(SESSION_COOKIE, sessionCookieOptions());
      throw new AppException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    request.auth = auth;
    if (!access.roles.includes(auth.user.role)) {
      throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
