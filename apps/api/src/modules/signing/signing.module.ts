import { Module } from '@nestjs/common';
import { PdfFillerModule } from '../pdf-filler/pdf-filler.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { RateHitsRepository } from '../../common/rate-limit/rate-hits.repository.js';
import { KioskRepository } from './kiosk.repository.js';
import { KioskSigningController } from './kiosk-signing.controller.js';
import { KioskSigningService } from './kiosk-signing.service.js';
import { SignedFilesService } from './signed-files.service.js';
import { SigningController } from './signing.controller.js';
import { SigningRepository } from './signing.repository.js';
import { SigningRateLimitService } from './signing-rate-limit.service.js';
import { SigningService } from './signing.service.js';
import { SigningSessionService } from './signing-session.service.js';
import { SigningStepsService } from './signing-steps.service.js';

/**
 * The public signing API: /api/sign/:token/* (3.13) and the office signing station
 * /api/kiosk/* (3.16), both through the same `SigningStepsService`.
 */
@Module({
  imports: [PdfFillerModule, TemplatesModule],
  controllers: [SigningController, KioskSigningController],
  providers: [
    SigningService,
    SigningStepsService,
    KioskSigningService,
    KioskRepository,
    SigningRepository,
    SigningRateLimitService,
    RateHitsRepository,
    SigningSessionService,
    SignedFilesService,
  ],
  exports: [SignedFilesService, KioskRepository],
})
export class SigningModule {}
