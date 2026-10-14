import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { QUEUE_SCHEMA } from '../../src/common/queue/queue.definitions.js';
import { QueueService } from '../../src/common/queue/queue.service.js';
import { WorkerModule } from '../../src/worker/worker.module.js';

/**
 * The real worker (WorkerModule) on the test database, like src/worker/main.ts, in this process.
 * Close it with `closeTestWorker` in afterAll / at the end of the test.
 */
export async function createTestWorker(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule, { logger: false });
}

/** Stops the queue first (as main.ts does), then the rest. */
export async function closeTestWorker(worker: INestApplicationContext): Promise<void> {
  await worker.get(QueueService).stop();
  await worker.close();
}

/**
 * Deletes every pg-boss job and schedule, so test files don't see each other's jobs.
 * resetDatabase() empties only `public`. Test database only.
 */
export async function clearQueueJobs(prisma: PrismaClient): Promise<void> {
  const [row] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!row?.name.endsWith('_test')) {
    throw new Error(`clearQueueJobs only runs on a *_test database, got "${row?.name ?? ''}".`);
  }
  await prisma.$executeRawUnsafe(`DELETE FROM "${QUEUE_SCHEMA}".job`);
  await prisma.$executeRawUnsafe(`DELETE FROM "${QUEUE_SCHEMA}".schedule`);
}

/** Polls `check` until it returns a value (not undefined), or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`waitFor: timed out after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
