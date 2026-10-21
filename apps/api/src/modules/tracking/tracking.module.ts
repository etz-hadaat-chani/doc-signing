import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RoundsModule } from '../rounds/rounds.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { EmployeeHistoryController } from './employee-history.controller.js';
import { EmployeeHistoryService } from './employee-history.service.js';
import { RoundsReadController } from './rounds-read.controller.js';
import { RoundsReadService } from './rounds-read.service.js';
import { TrackingRepository } from './tracking.repository.js';

/**
 * Status tracking (3.11, FR-TRK-1 to FR-TRK-5): the round list, details and employee table, the
 * dashboard and the employee's history. Read-only; send progress comes from the rounds module.
 */
@Module({
  imports: [AuthModule, RoundsModule],
  controllers: [RoundsReadController, DashboardController, EmployeeHistoryController],
  providers: [TrackingRepository, RoundsReadService, DashboardService, EmployeeHistoryService],
})
export class TrackingModule {}
