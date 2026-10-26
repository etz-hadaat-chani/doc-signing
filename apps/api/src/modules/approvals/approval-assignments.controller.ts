import {
  type Approved,
  type AssignmentResponses,
  type Returned,
  type ReturnBody,
  returnBodySchema,
  type SentAgain,
} from '@doc-signing/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { actorOf } from '../manual-handling/manual-handling.controller.js';
import { ApprovalsService } from './approvals.service.js';

const idPipe = new ZodValidationPipe(z.uuid());

/**
 * One assignment's answers and its approval (3.16 part B2, FR-TRK-6, PRD §11): managers and
 * officers read the answers; only managers approve, return and send again. Only the id is in the
 * address; the note goes in the body.
 */
@ApiTags('assignments')
@Controller('assignments')
export class ApprovalAssignmentsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @ApiOperation({
    summary: 'What the employee filled in, in template order; logged as a view',
    description:
      'Drawings are links straight to the storage, valid 5 minutes. The email section: the ' +
      'choice, the address she gave and whether it differs from the stored one (never the ' +
      "stored one). returnNote: the manager's note when returned for correction.",
  })
  @Roles('manager', 'officer')
  @Get(':id/responses')
  responses(
    @Param('id', idPipe) id: string,
    @Req() request: AuthRequest,
  ): Promise<AssignmentResponses> {
    return this.approvals.responses(id, actorOf(request));
  }

  @ApiOperation({
    summary: 'Approve a signed document waiting for approval; logged',
    description: 'The signed PDF never changes. 409 ASSIGNMENT_NOT_WAITING_FOR_APPROVAL.',
  })
  @Roles('manager')
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id', idPipe) id: string, @Req() request: AuthRequest): Promise<Approved> {
    return this.approvals.approve(id, actorOf(request));
  }

  @ApiOperation({
    summary: 'Return for correction with a note (1–500 characters): the assignment is cancelled',
    description:
      'The signed PDF stays stored; every link shows "cancelled". The note is shown to the ' +
      'employee in the correction round after the ID check, never in an email or the log. ' +
      '409 ASSIGNMENT_NOT_WAITING_FOR_APPROVAL.',
  })
  @ApiZodBody(returnBodySchema)
  @Roles('manager')
  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  returnForCorrection(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(returnBodySchema)) body: ReturnBody,
    @Req() request: AuthRequest,
  ): Promise<Returned> {
    return this.approvals.returnForCorrection(id, body, actorOf(request));
  }

  @ApiOperation({
    summary: 'After a return: create and send the one-employee correction round',
    description:
      'The newest version of the same template, the default settings, named "תיקון: <round> – ' +
      '<first last>". 409: ASSIGNMENT_NOT_RETURNED, CORRECTION_ROUND_EXISTS (details.roundId), ' +
      'EMPLOYEE_INACTIVE, ROUND_CANNOT_BE_CREATED (e.g. the template was archived).',
  })
  @Roles('manager')
  @Post(':id/send-again')
  @HttpCode(HttpStatus.CREATED)
  sendAgain(@Param('id', idPipe) id: string, @Req() request: AuthRequest): Promise<SentAgain> {
    return this.approvals.sendAgain(id, actorOf(request));
  }
}
