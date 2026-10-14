import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '../common/config/config.schema.js';
import { QueueService } from '../common/queue/queue.service.js';
import { WorkerModule } from './worker.module.js';

// Same as the API's main.ts: local dev reads the repo-root .env; elsewhere, real env vars.
const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const logger = new Logger('Worker');

async function bootstrap(): Promise<void> {
  loadConfig(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule, { abortOnError: false });
  logger.log('Worker started');

  // Stop the queue first (running jobs finish or are released for retry), then close the rest,
  // so a job never loses its database connection halfway.
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.log(`Worker stopping (${signal}), waiting for running jobs...`);
    try {
      await app.get(QueueService).stop();
      await app.close();
      logger.log('Worker stopped');
      process.exit(0);
    } catch (error) {
      logger.error(`Worker stop failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  };
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
}

bootstrap().catch((error: unknown) => {
  logger.error(`Worker failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
