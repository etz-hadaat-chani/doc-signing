import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import pg from 'pg';

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

    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      const result = await client.query<{ server_version: string }>('SHOW server_version');
      this.logger.log(`Database connected (PostgreSQL ${result.rows[0]?.server_version ?? '?'})`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database connection failed: ${reason}. Is \`docker compose up\` running?`);
      throw error;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
