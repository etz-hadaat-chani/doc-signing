import {
  type ManualListQuery,
  manualListQuerySchema,
  type ManualRow,
  manualSearchSchema,
  type ManualSendInput,
  manualSendSchema,
  type ManualSent,
  type Paged,
} from '@doc-signing/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiZodBody, ApiZodQuery } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { ManualHandlingService } from './manual-handling.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
export function actorOf(request: AuthRequest): TemplateActor {
  if (!request.auth) throw new Error('Manual handling used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

const SEARCH_EXAMPLE = JSON.stringify({ q: 'כהן', kind: ['no_email'], page: 1 });

/** Manual handling (3.16 part A, PRD FR-MAN-1, A10): manager only (PRD §9). */
@ApiTags('manual-handling')
@Controller('manual-handling')
export class ManualHandlingController {
  constructor(private readonly manual: ManualHandlingService) {}

  @ApiOperation({
    summary:
      'Employees with no email, a wrong email or missing details, across sent rounds, and ' +
      'signed documents whose employee gave another email (FR-MAN-1)',
    description:
      'Filters: roundId, dept (department at send time), kind (repeat for several). Rows say ' +
      'when they are ready to send ("email added", "email fixed", "details completed") and ' +
      'what is missing (names only). No search text here: use POST …/search.',
  })
  @ApiZodQuery(manualListQuerySchema)
  @Roles('manager')
  @Get()
  list(
    @Query(new ZodValidationPipe(manualListQuerySchema)) query: ManualListQuery,
  ): Promise<Paged<ManualRow>> {
    return this.manual.list(query);
  }

  @ApiOperation({
    summary: 'The same list searched by name, employee number or full ID number (in the body)',
    description: `The same filters as the GET, plus q. Example: \`${SEARCH_EXAMPLE}\``,
  })
  @ApiZodBody(manualSearchSchema)
  @Roles('manager')
  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(
    @Body(new ZodValidationPipe(manualSearchSchema)) body: ManualListQuery,
  ): Promise<Paged<ManualRow>> {
    return this.manual.list(body);
  }

  @ApiOperation({
    summary: 'Send the rows ready to send: a normal invitation with a new link (FR-MAN-1)',
    description:
      'All rows or none. no_email needs a valid email now; invalid_email a valid email ' +
      'different from the one that bounced; missing_data is checked again and its values ' +
      'saved (still missing → 409 MISSING_DATA_STILL_MISSING; no valid email → no_email, ' +
      'printable). 409 details.refused lists every refused row with its code.',
  })
  @ApiZodBody(manualSendSchema)
  @Roles('manager')
  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  send(
    @Body(new ZodValidationPipe(manualSendSchema)) body: ManualSendInput,
    @Req() request: AuthRequest,
  ): Promise<ManualSent> {
    return this.manual.send(body, actorOf(request));
  }
}
