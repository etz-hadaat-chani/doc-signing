import { SIGN_RATE_WINDOW_MINUTES } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The counter of IPs we can't name (no socket address): one shared bucket. */
const UNKNOWN_IP = '::';

/** The window a moment falls in: fixed 15-minute steps from a fixed origin, in SQL. */
const WINDOW = `${String(SIGN_RATE_WINDOW_MINUTES)} minutes`;

export interface RateCount<S extends string = string> {
  scope: S;
  hits: number;
  /** Seconds until the window ends. */
  retryAfter: number;
}

/**
 * Per-IP request counters in Postgres (`signing_rate_hits`: scope, ip, 15-minute window), so
 * they hold across processes and restarts. Shared by the signing limits (3.13) and the email
 * webhook (3.15, scope `email_webhook`); the daily cleanup drops windows older than a day.
 */
@Injectable()
export class RateHitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Counts one request in each scope (one statement); returns the counts of this window. */
  async count<S extends string>(scopes: readonly S[], ip: string | null): Promise<RateCount<S>[]> {
    return this.prisma.$queryRaw<RateCount<S>[]>`
      INSERT INTO signing_rate_hits (scope, ip, window_start, hits)
      SELECT s, ${ip ?? UNKNOWN_IP}::inet, ${windowSql()}, 1
      FROM unnest(${[...scopes]}::text[]) AS s
      ON CONFLICT (scope, ip, window_start)
        DO UPDATE SET hits = signing_rate_hits.hits + 1
      RETURNING scope, hits, ${retryAfterSql()} AS "retryAfter"`;
  }

  /** This window's count of one scope, without counting; null when none yet. */
  async current(scope: string, ip: string | null): Promise<Omit<RateCount, 'scope'> | null> {
    const rows = await this.prisma.$queryRaw<Omit<RateCount, 'scope'>[]>`
      SELECT hits, ${retryAfterSql()} AS "retryAfter"
      FROM signing_rate_hits
      WHERE scope = ${scope} AND ip = ${ip ?? UNKNOWN_IP}::inet
        AND window_start = ${windowSql()}`;
    return rows[0] ?? null;
  }
}

function windowSql() {
  return Prisma.sql`date_bin(${WINDOW}::interval, now(), timestamptz '2000-01-01 00:00:00+00')`;
}

function retryAfterSql() {
  return Prisma.sql`ceil(extract(epoch FROM (${windowSql()} + ${WINDOW}::interval - now())))::int`;
}
