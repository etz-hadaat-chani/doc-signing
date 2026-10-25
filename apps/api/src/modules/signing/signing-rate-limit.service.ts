import type { SignRateScope } from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppConfig } from '../../common/config/config.schema.js';
import { AppException } from '../../common/errors/app.exception.js';
import { RateHitsRepository } from '../../common/rate-limit/rate-hits.repository.js';

/**
 * Per-IP limits on the public signing routes (3.13, NFR-SEC-3), counted in Postgres
 * (`RateHitsRepository`). They only stop floods and link scans: one filter IP may carry hundreds
 * of employees (PRD §2), so the numbers are high and set in env; the real guard is the 5-attempt
 * lock per link. The first request over a limit in a window is logged (`sign.rate_limited`), to
 * tune the numbers.
 */
@Injectable()
export class SigningRateLimitService {
  constructor(
    private readonly hits: RateHitsRepository,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /** Counts this request in each scope (one statement); 429 when one goes over its limit. */
  async hit(scopes: readonly SignRateScope[], ip: string | null): Promise<void> {
    const counted = await this.hits.count(scopes, ip);
    for (const { scope, hits, retryAfter } of counted) {
      const limit = this.config.signRateLimits[scope];
      if (hits <= limit) continue;
      if (hits === limit + 1) await this.logBlocked(scope, limit, ip);
      throw this.tooMany(retryAfter);
    }
  }

  /** 429 when the IP already reached the scope's limit; counts nothing (wrong ID numbers). */
  async assertUnder(scope: SignRateScope, ip: string | null): Promise<void> {
    const row = await this.hits.current(scope, ip);
    if (row && row.hits >= this.config.signRateLimits[scope]) throw this.tooMany(row.retryAfter);
  }

  /** Counts one more (a wrong ID number); logs when the IP reaches the limit. */
  async add(scope: SignRateScope, ip: string | null): Promise<void> {
    const [counted] = await this.hits.count([scope], ip);
    const limit = this.config.signRateLimits[scope];
    if (counted?.hits === limit) await this.logBlocked(scope, limit, ip);
  }

  private tooMany(retryAfter: number): AppException {
    return new AppException('SIGN_TOO_MANY_REQUESTS', HttpStatus.TOO_MANY_REQUESTS, {
      retryAfter: Math.max(1, retryAfter),
    });
  }

  private async logBlocked(scope: SignRateScope, limit: number, ip: string | null) {
    await this.audit.record({
      actor: { type: 'employee' },
      action: 'sign.rate_limited',
      entity: { type: 'assignment', id: null },
      ip,
      details: { scope, limit },
    });
  }
}
