import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PdfFillerModule } from '../pdf-filler/pdf-filler.module.js';
import { InvitationPreviewService } from './invitation-preview.service.js';
import { TemplatePreviewService } from './template-preview.service.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesRepository } from './templates.repository.js';
import { TemplatesService } from './templates.service.js';

/**
 * Department templates (FR-TPL). Exports the service and the repository (the recipient preview
 * and round creation, 3.8 / 3.9, read active templates; round creation locks them).
 */
@Module({
  imports: [AuthModule, PdfFillerModule],
  controllers: [TemplatesController],
  providers: [
    TemplatesService,
    TemplatePreviewService,
    InvitationPreviewService,
    TemplatesRepository,
  ],
  exports: [TemplatesService, TemplatesRepository],
})
export class TemplatesModule {}
