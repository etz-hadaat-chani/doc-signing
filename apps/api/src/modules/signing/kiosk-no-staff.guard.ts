import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../common/errors/app.exception.js';
import { sessionCookie } from '../auth/auth-request.js';
import { SessionService } from '../auth/session.service.js';

/**
 * The office signing station runs on a computer where no staff user is signed in (5.7, decision
 * D1): a kiosk request that carries a valid staff session cookie is refused with 409
 * `KIOSK_STAFF_SIGNED_IN`, so the employee never sits next to an open staff app. The check
 * never extends or ends that session (`isSignedIn`); an old or unknown staff cookie passes, and
 * the kiosk still never reads who the staff user is.
 */
@Injectable()
export class KioskNoStaffGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (await this.sessions.isSignedIn(sessionCookie(request))) {
      throw new AppException('KIOSK_STAFF_SIGNED_IN', HttpStatus.CONFLICT);
    }
    return true;
  }
}
