import { SIGN_RATE_WINDOW_MINUTES, type SignRateScope } from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppConfig } from '../../common/config/config.schema.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** The counter of IPs we can't name (no socket address): one shared bucket. */
const UNKNOWN_IP = '::';

/** The window a moment falls in: fixed 15-minute steps from a fixed origin, in SQL. */
const WINDOW = `${String(SIGN_RATE_WINDOW_MINUTES)} minutes`;

interface Counted {
  scope: SignRateScope;
  hits: number;
  /** Seconds until the window ends. */
  retryAfter: number;
}

/**
 * Per-IP limits on the public signing routes (3.13, NFR-SEC-3), kept in Postgres
 * (`signing_rate_hits`) so they hold across processes and restarts. They only stop floods and
 * link scans: one filter IP may carry hundreds of employees (PRD §2), so the numbers are high
 * and set in env; the real guard is the 5-attempt lock per link. The first request over a limit
 * in a window is logged (`sign.rate_limited`), to tune the numbers.
 */
@Injectable()
export class SigningRateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /** Counts this request in each scope (one statement); 429 when one goes over its limit. */
  async hit(scopes: readonly SignRateScope[], ip: string | null): Promise<void> {
    const counted = await this.count(scopes, ip);
    for (const { scope, hits, retryAfter } of counted) {
      const limit = this.config.signRateLimits[scope];
      if (hits <= limit) continue;
      if (hits === limit + 1) await this.logBlocked(scope, limit, ip);
      throw this.tooMany(retryAfter);
    }
  }

  /** 429 when the IP already reached the scope's limit; counts nothing (wrong ID numbers). */
  async assertUnder(scope: SignRateScope, ip: string | null): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ hits: number; retryAfter: number }[]>`
      SELECT hits, ${this.retryAfterSql()} AS "retryAfter"
      FROM signing_rate_hits
      WHERE scope = ${scope} AND ip = ${ip ?? UNKNOWN_IP}::inet
        AND window_start = ${this.windowSql()}`;
    const [row] = rows;
    if (row && row.hits >= this.config.signRateLimits[scope]) throw this.tooMany(row.retryAfter);
  }

  /** Counts one more (a wrong ID number); logs when the IP reaches the limit. */
  async add(scope: SignRateScope, ip: string | null): Promise<void> {
    const [counted] = await this.count([scope], ip);
    const limit = this.config.signRateLimits[scope];
    if (counted?.hits === limit) await this.logBlocked(scope, limit, ip);
  }

  private async count(scopes: readonly SignRateScope[], ip: string | null): Promise<Counted[]> {
    return this.prisma.$queryRaw<Counted[]>`
      INSERT INTO signing_rate_hits (scope, ip, window_start, hits)
      SELECT s, ${ip ?? UNKNOWN_IP}::inet, ${this.windowSql()}, 1
      FROM unnest(${[...scopes]}::text[]) AS s
      ON CONFLICT (scope, ip, window_start)
        DO UPDATE SET hits = signing_rate_hits.hits + 1
      RETURNING scope, hits, ${this.retryAfterSql()} AS "retryAfter"`;
  }

  private windowSql() {
    return Prisma.sql`date_bin(${WINDOW}::interval, now(), timestamptz '2000-01-01 00:00:00+00')`;
  }

  private retryAfterSql() {
    return Prisma.sql`ceil(extract(epoch FROM (${this.windowSql()} + ${WINDOW}::interval - now())))::int`;
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
