import type {
  AssignmentCancelled,
  AssignmentEmailQueued,
  AssignmentUnlocked,
} from '@doc-signing/shared';
import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { RoundActionsService } from './round-actions.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): TemplateActor {
  if (!request.auth) throw new Error('AssignmentsController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

const idPipe = new ZodValidationPipe(z.uuid());

/**
 * One employee in one round (PRD §11): the manager's actions (3.12). The round is read from the
 * assignment, so an action can't reach another round. No body. Every refusal is a 409 with a
 * Hebrew message; an unknown id is 404 ASSIGNMENT_NOT_FOUND.
 */
@ApiTags('assignments')
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly actions: RoundActionsService) {}

  @ApiOperation({
    summary:
      'Remind this employee now (FR-REM-3): a reminder with a new link; old links keep working',
    description:
      'sent / opened only, in a sending or active round whose link has not expired. 409: ' +
      'ASSIGNMENT_NOT_REMINDABLE, ASSIGNMENT_LOCKED (unlock first), EMPLOYEE_NO_VALID_EMAIL, ' +
      'EMAIL_ALREADY_QUEUED, REMIND_TOO_SOON (an email in the last hour; details.retryAfter), ' +
      'LINK_EXPIRED, ROUND_NOT_SENT, ROUND_NOT_OPEN, ASSIGNMENT_ALREADY_SIGNED / _CANCELLED.',
  })
  @Roles('manager')
  @Post(':id/remind')
  @HttpCode(HttpStatus.ACCEPTED)
  remind(
    @Param('id', idPipe) id: string,
    @Req() request: AuthRequest,
  ): Promise<AssignmentEmailQueued> {
    return this.actions.remind(id, actorOf(request));
  }

  @ApiOperation({
    summary: 'Resend the invitation: after a failed send, or after the wrong email was fixed',
    description:
      'pending with a failed last invitation ("send failed"), or invalid_email when the ' +
      "employee's email is now valid and different. 409: ASSIGNMENT_NOT_RESENDABLE (sent / " +
      'opened: use remind), EMAIL_NOT_CHANGED, EMPLOYEE_NO_VALID_EMAIL, EMAIL_ALREADY_QUEUED, ' +
      'ASSIGNMENT_LOCKED, LINK_EXPIRED, ROUND_NOT_SENT, ROUND_NOT_OPEN.',
  })
  @Roles('manager')
  @Post(':id/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  resend(
    @Param('id', idPipe) id: string,
    @Req() request: AuthRequest,
  ): Promise<AssignmentEmailQueued> {
    return this.actions.resend(id, actorOf(request));
  }

  @ApiOperation({
    summary: 'Unlock after 5 wrong ID attempts (at most twice per employee)',
    description:
      'Clears the lock and the attempt count; the status stays. Confirm with the employee ' +
      'first that it was her. 409: ASSIGNMENT_NOT_LOCKED, LINK_EXPIRED, UNLOCK_LIMIT_REACHED ' +
      '(cancel and handle her at the office), ROUND_NOT_SENT, ROUND_NOT_OPEN.',
  })
  @Roles('manager')
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(
    @Param('id', idPipe) id: string,
    @Req() request: AuthRequest,
  ): Promise<AssignmentUnlocked> {
    return this.actions.unlock(id, actorOf(request));
  }

  @ApiOperation({
    summary: 'Cancel for this employee (FR-RND-7): every link of hers shows "cancelled"',
    description:
      'Any open status, also in a draft. 409: ASSIGNMENT_ALREADY_SIGNED (return for ' +
      'correction instead), ASSIGNMENT_ALREADY_CANCELLED, ROUND_NOT_OPEN.',
  })
  @Roles('manager')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', idPipe) id: string,
    @Req() request: AuthRequest,
  ): Promise<AssignmentCancelled> {
    return this.actions.cancel(id, actorOf(request));
  }
}
