import type { DashboardSummary } from '@doc-signing/shared';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/access.decorators.js';
import { DashboardService } from './dashboard.service.js';

/** The dashboard (A2, PRD §11): managers and officers. */
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @ApiOperation({
    summary:
      'Totals across sending and active rounds (FR-TRK-1), each round with the rows needing ' +
      'attention, and the open drafts',
  })
  @Roles('manager', 'officer')
  @Get('summary')
  summary(): Promise<DashboardSummary> {
    return this.dashboard.summary();
  }
}
