import {
  type RecipientsPreviewReport,
  type RoundCancelled,
  recipientsPreviewSchema,
  roundCreateSchema,
  type RoundCreated,
  type RoundCreateInput,
  type RoundReminded,
  type RoundSelection,
  type RoundSendInput,
  roundSendSchema,
  type RoundSent,
} from '@doc-signing/shared';
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { RoundActionsService } from './round-actions.service.js';
import { RoundRecipientsService } from './round-recipients.service.js';
import { RoundSendService } from './round-send.service.js';
import { RoundsService } from './rounds.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): TemplateActor {
  if (!request.auth) throw new Error('RoundsController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

/** Bodies to paste on the Swagger page; replace the ids with real ones. */
const EXAMPLES = [
  JSON.stringify({
    mode: 'single_template',
    templateId: '<template id from GET /api/templates>',
    recipients: { all: true },
  }),
  JSON.stringify({
    mode: 'by_department',
    departmentTemplates: [{ departmentId: '<department id>', templateId: '<template id>' }],
    recipients: { departmentIds: ['<department id>'], employeeIds: ['<employee id>'] },
    alreadySigned: 'skip',
  }),
];

/** The same choices with a name and settings, for creating the round. */
const CREATE_EXAMPLES = [
  JSON.stringify({
    name: 'חוזה שנתי 2027',
    mode: 'single_template',
    templateId: '<template id from GET /api/templates>',
    recipients: { all: true },
  }),
  JSON.stringify({
    name: 'חוזה שנתי 2027',
    mode: 'by_department',
    recipients: { departmentIds: ['<department id>'] },
    alreadySigned: 'skip',
    settings: { reminderIntervalDays: 5, maxReminders: null, linkExpiryDays: 30 },
  }),
];

/** The send: first without a confirmation, then confirming the outdated templates of the 409. */
const SEND_EXAMPLES = [
  JSON.stringify({}),
  JSON.stringify({ confirmOutdatedTemplateIds: ['<template id from the 409 details>'] }),
];

/** Send rounds (PRD §11). Each route sets its own roles. */
@ApiTags('rounds')
@Controller('rounds')
export class RoundsController {
  constructor(
    private readonly recipients: RoundRecipientsService,
    private readonly rounds: RoundsService,
    private readonly sending: RoundSendService,
    private readonly actions: RoundActionsService,
  ) {}

  @ApiOperation({
    summary:
      'Create a draft round (FR-RND-1 to FR-RND-5): the round, its templates and one ' +
      'assignment per recipient (pending / no_email / missing_data). Nothing is sent',
    description:
      'The same choice as the recipient preview, plus a name and optional settings (left out ' +
      '= the defaults of GET /api/settings; linkExpiryDays counts from the send). 409 ' +
      'ROUND_CANNOT_BE_CREATED while the preview has blockers (in details). Examples:\n\n' +
      `\`${CREATE_EXAMPLES[0] ?? ''}\`\n\n\`${CREATE_EXAMPLES[1] ?? ''}\``,
  })
  @ApiZodBody(roundCreateSchema)
  @Roles('manager')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(roundCreateSchema)) body: RoundCreateInput,
    @Req() request: AuthRequest,
  ): Promise<RoundCreated> {
    return this.rounds.create(body, actorOf(request));
  }

  @ApiOperation({
    summary:
      'Send a draft round (FR-RND-5, FR-RND-6, FR-RND-8): values saved, statuses checked ' +
      'again, one invitation queued per employee with an email; the worker sends them',
    description:
      'Answers 202 at once; the emails go out in the background (round status sending, then ' +
      'active). The link expires linkExpiryDays after this moment. 409 ROUND_NOT_DRAFT for a ' +
      'round already sent or cancelled; 409 ROUND_TEMPLATE_NOT_READY (no override); 409 ' +
      'ROUND_TEMPLATE_OUTDATED when a template was archived or has a newer version: send again ' +
      "with every template id from its details to send the round's own version anyway. " +
      `Examples:\n\n\`${SEND_EXAMPLES[0] ?? ''}\`\n\n\`${SEND_EXAMPLES[1] ?? ''}\``,
  })
  @ApiZodBody(roundSendSchema)
  @Roles('manager')
  @Post(':id/send')
  @HttpCode(HttpStatus.ACCEPTED)
  send(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(roundSendSchema)) body: RoundSendInput,
    @Req() request: AuthRequest,
  ): Promise<RoundSent> {
    return this.sending.send(id, body, actorOf(request));
  }

  @ApiOperation({
    summary:
      'Remind everyone who has not signed, now (FR-REM-3): one reminder each, with a new link',
    description:
      'sent / opened rows of a sending or active round. Skipped and counted: locked, no valid ' +
      'email, an email still queued, an email in the last 24 hours (a second click the same ' +
      'day queues nothing). 409: ROUND_NOT_SENT (draft), ROUND_NOT_OPEN, LINK_EXPIRED.',
  })
  @Roles('manager')
  @Post(':id/remind')
  @HttpCode(HttpStatus.ACCEPTED)
  remind(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Req() request: AuthRequest,
  ): Promise<RoundReminded> {
    return this.actions.remindRound(id, actorOf(request));
  }

  @ApiOperation({
    summary: 'Cancel the round (FR-RND-7), also a draft: every open employee is cancelled',
    description:
      'Signed documents stay. Queued emails are not sent. Cannot be undone. 409 ROUND_NOT_OPEN ' +
      'for a closed or cancelled round.',
  })
  @Roles('manager')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Req() request: AuthRequest,
  ): Promise<RoundCancelled> {
    return this.actions.cancelRound(id, actorOf(request));
  }

  @ApiOperation({
    summary:
      'Recipient preview (FR-RND-4): counts, departments with their template, who is missing ' +
      'what. Field names only; nothing is created',
    description: `Examples:\n\n\`${EXAMPLES[0] ?? ''}\`\n\n\`${EXAMPLES[1] ?? ''}\``,
  })
  @ApiZodBody(recipientsPreviewSchema)
  @Roles('manager')
  @Post('recipients-preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @Body(new ZodValidationPipe(recipientsPreviewSchema)) body: RoundSelection,
    @Req() request: AuthRequest,
  ): Promise<RecipientsPreviewReport> {
    return this.recipients.preview(body, actorOf(request));
  }
}
