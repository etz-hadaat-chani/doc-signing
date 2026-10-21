import {
  type AssignmentRow,
  assignmentSearchSchema,
  type AssignmentTableQuery,
  assignmentTableQuerySchema,
  type Paged,
  type RoundDetails,
  type RoundListItem,
  type RoundListQuery,
  roundListQuerySchema,
} from '@doc-signing/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody, ApiZodQuery } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { RoundsReadService } from './rounds-read.service.js';

/** The reader. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): TemplateActor {
  if (!request.auth) throw new Error('RoundsReadController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

const SEARCH_EXAMPLES = [
  JSON.stringify({ q: 'כהן' }),
  JSON.stringify({ q: '1004', status: ['sent', 'opened'], page: 1, pageSize: 25 }),
];

/** Reading rounds (3.11, PRD §11): managers and officers; nothing here changes data. */
@ApiTags('rounds')
@Controller('rounds')
export class RoundsReadController {
  constructor(private readonly rounds: RoundsReadService) {}

  @ApiOperation({
    summary: 'Round list (A3): newest first, % signed; a draft reads "טיוטה" with its age',
  })
  @ApiZodQuery(roundListQuerySchema)
  @Roles('manager', 'officer')
  @Get()
  list(
    @Query(new ZodValidationPipe(roundListQuerySchema)) query: RoundListQuery,
  ): Promise<Paged<RoundListItem>> {
    return this.rounds.list(query);
  }

  @ApiOperation({
    summary:
      'Round details (A4): settings, templates, send progress, counts by status and by ' +
      'department (at send time), and the original round of a correction round',
  })
  @Roles('manager', 'officer')
  @Get(':id')
  details(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<RoundDetails> {
    return this.rounds.details(id);
  }

  @ApiOperation({
    summary: 'Employee table (A4, FR-TRK-2): filters and paging, no search text',
    description:
      'status (repeat for several display values), dept (department at send time), ' +
      'approval=waiting, returned=true. To search by name, employee number or ID use the ' +
      'POST …/assignments/search route: search text never goes in a URL.',
  })
  @ApiZodQuery(assignmentTableQuerySchema)
  @Roles('manager', 'officer')
  @Get(':id/assignments')
  table(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(assignmentTableQuerySchema)) query: AssignmentTableQuery,
    @Req() request: AuthRequest,
  ): Promise<Paged<AssignmentRow>> {
    return this.rounds.table(id, query, actorOf(request));
  }

  @ApiOperation({
    summary: 'Search the employee table by name, employee number or ID (the text in the body)',
    description:
      'The same filters as the GET, plus q. The ID number matches only in full. Examples:\n\n' +
      `\`${SEARCH_EXAMPLES[0] ?? ''}\`\n\n\`${SEARCH_EXAMPLES[1] ?? ''}\``,
  })
  @ApiZodBody(assignmentSearchSchema)
  @Roles('manager', 'officer')
  @Post(':id/assignments/search')
  @HttpCode(HttpStatus.OK)
  search(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(assignmentSearchSchema)) body: AssignmentTableQuery,
    @Req() request: AuthRequest,
  ): Promise<Paged<AssignmentRow>> {
    return this.rounds.table(id, body, actorOf(request));
  }
}
