import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import pg from 'pg';

const { Client } = pg;

/** A refused connection is an AggregateError with an empty message (one error per address tried). */
function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return [...new Set(error.errors.map(describeError))].join('; ');
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return error.message || (typeof code === 'string' ? code : error.name);
  }
  return String(error);
}

/**
 * Verifies at startup that the API can reach PostgreSQL, and fails fast if not.
 * Temporary: replaced by the Prisma service and /health in task 2.1.
 */
@Injectable()
export class DatabaseCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseCheckService.name);

  async onApplicationBootstrap(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      const message = 'DATABASE_URL is not set. Copy .env.example to .env in the repo root.';
      this.logger.error(message);
      throw new Error(message);
    }

    const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      const result = await client.query<{ version: string }>('SELECT version()');
      // "PostgreSQL 16.4 on x86_64-pc-linux-musl, ..." -> "PostgreSQL 16.4"
      const version = /^PostgreSQL \S+/.exec(result.rows[0]?.version ?? '')?.[0] ?? 'PostgreSQL';
      this.logger.log(`Database connected (${version})`);
    } catch (error) {
      const target = connectionString.replace(/\/\/[^@]*@/, '//***@');
      const message =
        `Database connection failed (${target}): ${describeError(error)}. ` +
        'Is `docker compose up -d` running?';
      this.logger.error(message);
      throw new Error(message, { cause: error });
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
