import {
  type ApprovalRow,
  type ApprovalsQuery,
  approvalsQuerySchema,
  type Paged,
} from '@doc-signing/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiZodQuery } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import { ApprovalsService } from './approvals.service.js';

/** The approvals list (3.16 part B2, FR-TRK-6, A10 tab): managers and officers (PRD §9). */
@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @ApiOperation({
    summary: 'Signed documents waiting for approval, across rounds, oldest signature first',
    description:
      'Filter: roundId. Each row names the boxes that need approval (labels only); the answers ' +
      'come from GET /api/assignments/:id/responses.',
  })
  @ApiZodQuery(approvalsQuerySchema)
  @Roles('manager', 'officer')
  @Get()
  list(
    @Query(new ZodValidationPipe(approvalsQuerySchema)) query: ApprovalsQuery,
  ): Promise<Paged<ApprovalRow>> {
    return this.approvals.list(query);
  }
}
