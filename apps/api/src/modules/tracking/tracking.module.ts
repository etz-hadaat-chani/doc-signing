import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RoundsModule } from '../rounds/rounds.module.js';
import { AssignmentDocumentController } from './assignment-document.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { EmployeeHistoryController } from './employee-history.controller.js';
import { EmployeeHistoryService } from './employee-history.service.js';
import { RoundExportService } from './round-export.service.js';
import { RoundFilesController } from './round-files.controller.js';
import { RoundZipService } from './round-zip.service.js';
import { RoundsReadController } from './rounds-read.controller.js';
import { RoundsReadService } from './rounds-read.service.js';
import { SignedDocumentService } from './signed-document.service.js';
import { TrackingExportRepository } from './tracking-export.repository.js';
import { TrackingRepository } from './tracking.repository.js';

/**
 * Status tracking (3.11, FR-TRK-1 to FR-TRK-5): the round list, details and employee table, the
 * dashboard and the employee's history; the status export, the ZIP of signed files and the
 * signed-document link (3.17). Read-only; send progress comes from the rounds module.
 */
@Module({
  imports: [AuthModule, RoundsModule],
  controllers: [
    RoundsReadController,
    RoundFilesController,
    DashboardController,
    EmployeeHistoryController,
    AssignmentDocumentController,
  ],
  providers: [
    TrackingRepository,
    TrackingExportRepository,
    RoundsReadService,
    DashboardService,
    EmployeeHistoryService,
    RoundExportService,
    RoundZipService,
    SignedDocumentService,
  ],
})
export class TrackingModule {}
