import { Module } from '@nestjs/common';
import { RateHitsRepository } from '../../common/rate-limit/rate-hits.repository.js';
import { EmailBounceRepository } from './email-bounce.repository.js';
import { EmailBounceService } from './email-bounce.service.js';
import { WebhookRateLimitService } from './webhook-rate-limit.service.js';
import { WebhooksController } from './webhooks.controller.js';

/** The email provider's notices (3.15): POST /api/webhooks/email. */
@Module({
  controllers: [WebhooksController],
  providers: [
    EmailBounceService,
    EmailBounceRepository,
    WebhookRateLimitService,
    RateHitsRepository,
  ],
})
export class WebhooksModule {}
