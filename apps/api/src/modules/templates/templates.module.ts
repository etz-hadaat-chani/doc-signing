import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PdfFillerModule } from '../pdf-filler/pdf-filler.module.js';
import { TemplatePreviewService } from './template-preview.service.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesRepository } from './templates.repository.js';
import { TemplatesService } from './templates.service.js';

/** Department templates (FR-TPL). Exports the service: the send (3.10) calls `lockTemplate`. */
@Module({
  imports: [AuthModule, PdfFillerModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplatePreviewService, TemplatesRepository],
  exports: [TemplatesService],
})
export class TemplatesModule {}
