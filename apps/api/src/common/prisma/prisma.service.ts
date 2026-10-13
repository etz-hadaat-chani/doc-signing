import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../config/config.schema.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * A short reason for a failed connection. Prisma's message is only "Invalid `prisma.$queryRaw()`
 * invocation:" with the reason in `code` (e.g. ECONNREFUSED); pg's refused connection is an
 * AggregateError with an empty message (one error per address tried).
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return [...new Set(error.errors.map(describeError))].join('; ');
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const message = error.message.replace(/^\s*Invalid `[^`]+` invocation:?/, '').trim();
    return message || (typeof code === 'string' ? code : error.name);
  }
  return String(error);
}

/** The connection URL with user and password hidden, for log lines. */
export function maskDatabaseUrl(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@');
}

/**
 * The one Prisma client of the process. Checks the database at startup (the API won't start
 * without it) and disconnects on shutdown. No query logging: parameters can hold ID numbers.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 5000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Database connected');
    } catch (error) {
      // main.ts logs it once and exits.
      throw new Error(
        `Database connection failed (${maskDatabaseUrl(this.config.databaseUrl)}): ` +
          `${describeError(error)}. Is \`docker compose up -d\` running?`,
        { cause: error },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
