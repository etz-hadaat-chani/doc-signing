import {
  type RecipientsPreviewReport,
  recipientsPreviewSchema,
  type RoundSelection,
} from '@doc-signing/shared';
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { RoundRecipientsService } from './round-recipients.service.js';

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

/** Send rounds (PRD §11). Each route sets its own roles. */
@ApiTags('rounds')
@Controller('rounds')
export class RoundsController {
  constructor(private readonly recipients: RoundRecipientsService) {}

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
