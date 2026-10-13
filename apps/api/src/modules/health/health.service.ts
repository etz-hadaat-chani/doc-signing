import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { redactForLog } from '../../common/errors/redact.js';

export const HEALTH_DB_TIMEOUT_MS = 2000;

export interface HealthStatus {
  status: 'ok' | 'error';
  database: 'ok' | 'down';
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Database reachable within the timeout → ok. Details go to the log, never to the caller. */
  async check(): Promise<HealthStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer within ${HEALTH_DB_TIMEOUT_MS} ms`)),
        HEALTH_DB_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(redactForLog(`Health check: database down (${reason})`));
      return { status: 'error', database: 'down' };
    } finally {
      clearTimeout(timer);
    }
  }
}
