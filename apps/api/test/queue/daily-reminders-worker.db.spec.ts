import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hashSigningToken } from '../../src/common/email/signing-token.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { DAILY_REMINDERS_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { QueueService } from '../../src/common/queue/queue.service.js';
import { createTestApp } from '../setup/app.js';
import { messagesTo } from '../setup/mailpit.js';
import { sentRoundOf } from '../setup/round-actions.js';
import { seedRoundsWorld } from '../setup/rounds.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

/**
 * The daily reminders through the real worker (3.14): the schedule it stores, and a run added
 * like `pnpm job:reminders --days-ahead 1` reaching Mailpit. Made-up employees only.
 */

const NUMBERS = ['1001', '1002'];
/** pg-boss polls every 2 s per queue: the run, then the reminders. */
const TIMEOUT_MS = 30_000;

let app: INestApplication;
let prisma: PrismaService;
let worker: INestApplicationContext | undefined;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  if (worker) await closeTestWorker(worker);
  await app.close();
});

it(
  'stores the schedule and sends a run to Mailpit, each reminder with its own link',
  async () => {
    const world = await seedRoundsWorld(app, prisma);
    await clearQueueJobs(prisma);
    const round = await sentRoundOf(app, prisma, world, NUMBERS);
    worker = await createTestWorker();

    const queue = worker.get(QueueService);
    expect(await queue.findSchedule(DAILY_REMINDERS_QUEUE)).toEqual({
      cron: '0 9 * * 0-4',
      timezone: 'Asia/Jerusalem',
    });

    // Sent two days ago, interval 3: due "tomorrow".
    const id = await app.get(QueueService).send(DAILY_REMINDERS_QUEUE, {
      trigger: 'manual',
      daysAhead: 1,
    });
    expect(id).not.toBeNull();
    // A second run while the first waits or runs: refused by the exclusive queue.
    expect(
      await app.get(QueueService).send(DAILY_REMINDERS_QUEUE, { trigger: 'manual' }),
    ).toBeNull();

    const reminders = await waitFor(async () => {
      const rows = await prisma.emailMessage.findMany({
        where: { type: 'reminder', status: 'sent', assignment: { roundId: round.roundId } },
      });
      return rows.length === NUMBERS.length ? rows : undefined;
    });
    for (const number of NUMBERS) {
      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: world.emp[number] ?? '' },
      });
      const [message] = await messagesTo(employee.email ?? '', 1);
      expect(message?.Subject).toContain('תזכורת');
      const link = /\/sign\/([A-Za-z0-9_-]{43})/.exec(message?.Text ?? '');
      const row = reminders.find((r) => r.assignmentId === round.assignment[number]);
      expect(row?.tokenHash).toBe(hashSigningToken(link?.[1] ?? ''));
    }
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'reminders.daily_run' } });
    expect(audit?.details).toMatchObject({ trigger: 'manual', queued: NUMBERS.length });
    expect(
      await prisma.assignment.count({ where: { roundId: round.roundId, reminderCount: 1 } }),
    ).toBe(NUMBERS.length);
  },
  TIMEOUT_MS,
);
