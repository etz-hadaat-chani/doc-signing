import {
  Body,
  Controller,
  type INestApplication,
  type INestApplicationContext,
  Post,
} from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import {
  DEFAULT_RETRY,
  QUEUE_SCHEMA,
  type QueueDefinition,
} from '../../src/common/queue/queue.definitions.js';
import { type JobContext, QueueService } from '../../src/common/queue/queue.service.js';
import { Public } from '../../src/modules/auth/access.decorators.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

/** Test-only queues: fast retries so the failure path finishes in seconds. */
const quickRetry = { ...DEFAULT_RETRY, retryLimit: 1, retryDelay: 0, retryBackoff: false };
const ECHO_QUEUE: QueueDefinition<{ n: number }> = {
  name: 'test-echo',
  policy: 'standard',
  retry: quickRetry,
};
const FAILING_QUEUE: QueueDefinition<{ n: number }> = {
  name: 'test-failing',
  policy: 'standard',
  retry: quickRetry,
};
const EXCLUSIVE_QUEUE: QueueDefinition<{ n: number }> = {
  name: 'test-exclusive',
  policy: 'exclusive',
  retry: quickRetry,
};
const TEST_QUEUES = [ECHO_QUEUE, FAILING_QUEUE, EXCLUSIVE_QUEUE];
const fastPolling = { pollingIntervalSeconds: 0.5 };

/** Test-only route: the API adds a job, the way a real service will. */
@Public()
@Controller('test-queue')
class QueueTestController {
  constructor(private readonly queue: QueueService) {}

  @Post()
  async add(@Body() body: { n: number }): Promise<{ id: string | null }> {
    return { id: await this.queue.send(ECHO_QUEUE, { n: body.n }) };
  }
}

let app: INestApplication;
let api: QueueService;
let prisma: PrismaService;
let worker: INestApplicationContext | undefined;

beforeAll(async () => {
  app = await createTestApp({ controllers: [QueueTestController] });
  api = app.get(QueueService);
  prisma = app.get(PrismaService);
  for (const queue of TEST_QUEUES) await api.ensureQueue(queue);
});

beforeEach(async () => {
  await clearQueueJobs(prisma);
});

afterEach(async () => {
  if (worker) await closeTestWorker(worker);
  worker = undefined;
});

afterAll(async () => {
  await app.close();
});

/** Starts the worker with `handler` on `queue`. */
async function startWorker<T extends object>(
  queue: QueueDefinition<T>,
  handler: (job: JobContext<T>) => Promise<void>,
): Promise<QueueService> {
  worker = await createTestWorker();
  const service = worker.get(QueueService);
  await service.work(queue, handler, fastPolling);
  return service;
}

function stateOf(queue: QueueDefinition, id: string) {
  return api.findJob(queue, id);
}

/** Waits until the job reaches `state`. */
function waitForState(queue: QueueDefinition, id: string, state: string) {
  return waitFor(async () => ((await stateOf(queue, id))?.state === state ? true : undefined));
}

describe('job queue', () => {
  it('runs a job added by the API in the worker; the API works without a worker', async () => {
    const response = await request(httpServer(app)).post('/api/test-queue').send({ n: 7 });
    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    expect(id).toEqual(expect.any(String));

    // No worker yet: the job waits.
    expect(await stateOf(ECHO_QUEUE, id)).toMatchObject({ state: 'created' });

    const seen: JobContext<{ n: number }>[] = [];
    await startWorker(ECHO_QUEUE, (job) => {
      seen.push(job);
      return Promise.resolve();
    });

    await waitForState(ECHO_QUEUE, id, 'completed');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id, data: { n: 7 }, attempt: 1, isLastAttempt: false });
  });

  it('retries a failing job, then marks it failed after the retry limit', async () => {
    const attempts: { attempt: number; isLastAttempt: boolean }[] = [];
    await startWorker(FAILING_QUEUE, ({ attempt, isLastAttempt }) => {
      attempts.push({ attempt, isLastAttempt });
      return Promise.reject(new Error('temporary failure'));
    });

    const id = await api.send(FAILING_QUEUE, { n: 1 });
    if (!id) throw new Error('job not added');

    await waitForState(FAILING_QUEUE, id, 'failed');
    expect(attempts).toEqual([
      { attempt: 1, isLastAttempt: false },
      { attempt: 2, isLastAttempt: true },
    ]);
  });

  it('exclusive queue: refuses a second job while one is waiting or running', async () => {
    const first = await api.send(EXCLUSIVE_QUEUE, { n: 1 });
    expect(first).toEqual(expect.any(String));
    expect(await api.send(EXCLUSIVE_QUEUE, { n: 2 })).toBeNull();

    // Running counts too: hold the job open until we have tried again.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let running = false;
    await startWorker(EXCLUSIVE_QUEUE, async () => {
      running = true;
      await held;
    });
    await waitFor(() => Promise.resolve(running ? true : undefined));
    expect(await api.send(EXCLUSIVE_QUEUE, { n: 3 })).toBeNull();

    release();
    await waitForState(EXCLUSIVE_QUEUE, first ?? '', 'completed');
    expect(await api.send(EXCLUSIVE_QUEUE, { n: 4 })).toEqual(expect.any(String));
  });

  it('exclusive queue with singletonKey: one job per key', async () => {
    const send = (n: number, key: string) =>
      api.send(EXCLUSIVE_QUEUE, { n }, { singletonKey: key });
    expect(await send(1, 'assignment-a')).toEqual(expect.any(String));
    expect(await send(2, 'assignment-a')).toBeNull();
    expect(await send(3, 'assignment-b')).toEqual(expect.any(String));
  });

  it('sendMany adds jobs only when the transaction commits; a key already waiting is skipped', async () => {
    const jobs = (keys: string[]) => keys.map((key, n) => ({ data: { n }, singletonKey: key }));
    await expect(
      prisma.$transaction(async (tx) => {
        expect(await api.sendMany(EXCLUSIVE_QUEUE, jobs(['k1', 'k2']), tx)).toBe(2);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    const count = async () =>
      (
        await prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "${QUEUE_SCHEMA}".job WHERE name = $1`,
          EXCLUSIVE_QUEUE.name,
        )
      )[0]?.n;
    expect(await count()).toBe(0n);

    const added = await prisma.$transaction((tx) =>
      api.sendMany(EXCLUSIVE_QUEUE, jobs(['k1', 'k2']), tx),
    );
    expect(added).toBe(2);
    expect(
      await prisma.$transaction((tx) => api.sendMany(EXCLUSIVE_QUEUE, jobs(['k2', 'k3']), tx)),
    ).toBe(1);
    expect(await count()).toBe(3n);
  });

  it('batchSize > 1: runs every job, one at a time, and retries only the one that failed', async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5].map((n) => api.send(FAILING_QUEUE, { n })));
    const runs: { n: number; attempt: number }[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    worker = await createTestWorker();
    await worker.get(QueueService).work(
      FAILING_QUEUE,
      async ({ data, attempt }) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        runs.push({ n: data.n, attempt });
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent -= 1;
        if (data.n === 3) throw new Error('only this one fails');
      },
      { ...fastPolling, batchSize: 3 },
    );
    for (const [index, id] of ids.entries()) {
      await waitForState(FAILING_QUEUE, id ?? '', index === 2 ? 'failed' : 'completed');
    }
    expect(maxConcurrent).toBe(1);
    expect(runs.filter(({ n }) => n !== 3).every(({ attempt }) => attempt === 1)).toBe(true);
    expect(runs.filter(({ n }) => n === 3).map(({ attempt }) => attempt)).toEqual([1, 2]);
    expect(runs).toHaveLength(6);
  });

  it('only the worker runs jobs and schedules', async () => {
    await expect(api.work(ECHO_QUEUE, async () => {})).rejects.toThrow('worker only');
  });

  it('two workers keep one schedule', async () => {
    const first = await createTestWorker();
    const second = await createTestWorker();
    try {
      const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM "${QUEUE_SCHEMA}".schedule WHERE name = 'maintenance-cleanup'`,
      );
      expect(rows).toEqual([{ count: 1n }]);
    } finally {
      await closeTestWorker(second);
      await closeTestWorker(first);
    }
  });

  it('resetDatabase() still works and leaves the pg-boss schema alone', async () => {
    const id = await api.send(ECHO_QUEUE, { n: 1 });
    if (!id) throw new Error('job not added');

    await resetDatabase(prisma);

    expect(await stateOf(ECHO_QUEUE, id)).toMatchObject({ state: 'created' });
  });
});
