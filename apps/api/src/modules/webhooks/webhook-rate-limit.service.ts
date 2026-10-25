import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../common/config/config.schema.js';
import { AppException } from '../../common/errors/app.exception.js';
import { RateHitsRepository } from '../../common/rate-limit/rate-hits.repository.js';

/** The counter's scope in `signing_rate_hits` (the table's CHECK: `^[a-z_]{1,20}$`). */
export const WEBHOOK_RATE_SCOPE = 'email_webhook';

/**
 * Per-IP limit on the email webhook (3.15), counted before the signature is checked, so a flood
 * of unsigned requests is cut off too. `EMAIL_WEBHOOK_RATE_LIMIT` requests per 15 minutes
 * (default 3,000: a provider reporting every bounce of a 1,500-employee send stays well under).
 * The first request over it in a window is logged (one line, no audit row: no employee or staff
 * user is involved).
 */
@Injectable()
export class WebhookRateLimitService {
  private readonly logger = new Logger(WebhookRateLimitService.name);

  constructor(
    private readonly hits: RateHitsRepository,
    private readonly config: AppConfig,
  ) {}

  async hit(ip: string | null): Promise<void> {
    const [counted] = await this.hits.count([WEBHOOK_RATE_SCOPE], ip);
    const limit = this.config.emailWebhook.rateLimit;
    if (counted === undefined || counted.hits <= limit) return;
    if (counted.hits === limit + 1) {
      this.logger.warn(`Email webhook: one IP went over ${String(limit)} requests in 15 minutes`);
    }
    throw new AppException('TOO_MANY_REQUESTS', HttpStatus.TOO_MANY_REQUESTS, {
      retryAfter: Math.max(1, counted.retryAfter),
    });
  }
}
