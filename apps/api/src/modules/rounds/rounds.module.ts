import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PdfFillerModule } from '../pdf-filler/pdf-filler.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { RoundRecipientsRepository } from './round-recipients.repository.js';
import { RoundRecipientsService } from './round-recipients.service.js';
import { RoundsController } from './rounds.controller.js';

/**
 * Send rounds (FR-RND). So far the recipient preview (3.8). Exports `RoundRecipientsService`:
 * round creation (3.9) resolves the same choice with `resolve`.
 */
@Module({
  imports: [AuthModule, TemplatesModule, PdfFillerModule],
  controllers: [RoundsController],
  providers: [RoundRecipientsService, RoundRecipientsRepository],
  exports: [RoundRecipientsService],
})
export class RoundsModule {}
