import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PdfFillerModule } from '../pdf-filler/pdf-filler.module.js';
import { RoundsModule } from '../rounds/rounds.module.js';
import { SigningModule } from '../signing/signing.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { ManualAssignmentsController } from './manual-assignments.controller.js';
import { ManualDocumentsService } from './manual-documents.service.js';
import { ManualHandlingController } from './manual-handling.controller.js';
import { ManualHandlingRepository } from './manual-handling.repository.js';
import { ManualHandlingService } from './manual-handling.service.js';

/**
 * Manual handling (3.16 part A, FR-MAN-1 to FR-MAN-3): the list, the one-click send (the 3.10
 * invitation steps through `SigningEmailQueue`), print and the scanned paper signature (stored
 * with `SignedFilesService`, never overwriting). Part B adds the office kiosk and approvals.
 */
@Module({
  imports: [AuthModule, TemplatesModule, PdfFillerModule, RoundsModule, SigningModule],
  controllers: [ManualHandlingController, ManualAssignmentsController],
  providers: [ManualHandlingService, ManualDocumentsService, ManualHandlingRepository],
})
export class ManualHandlingModule {}
