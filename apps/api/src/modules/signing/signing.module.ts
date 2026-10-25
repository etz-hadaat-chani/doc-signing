import { Module } from '@nestjs/common';
import { PdfFillerModule } from '../pdf-filler/pdf-filler.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { RateHitsRepository } from '../../common/rate-limit/rate-hits.repository.js';
import { SignedFilesService } from './signed-files.service.js';
import { SigningController } from './signing.controller.js';
import { SigningRepository } from './signing.repository.js';
import { SigningRateLimitService } from './signing-rate-limit.service.js';
import { SigningService } from './signing.service.js';
import { SigningSessionService } from './signing-session.service.js';

/** The public signing API (3.13): /api/sign/:token/*. */
@Module({
  imports: [PdfFillerModule, TemplatesModule],
  controllers: [SigningController],
  providers: [
    SigningService,
    SigningRepository,
    SigningRateLimitService,
    RateHitsRepository,
    SigningSessionService,
    SignedFilesService,
  ],
})
export class SigningModule {}
