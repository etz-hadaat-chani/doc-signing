import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { INVITATION_QUEUE, QUEUE_SCHEMA } from '../../src/common/queue/queue.definitions.js';
import { STALE_AFTER_MINUTES } from '../../src/modules/rounds/daily-reminders.service.js';
import { createTestApp } from '../setup/app.js';
import { dailyReminders, inDays } from '../setup/daily-reminders.js';
import { sentRoundOf, tokenHash } from '../setup/round-actions.js';
import {
  createDraft,
  createTemplate,
  type RoundsWorld,
  seedRoundsWorld,
  sendRound,
} from '../setup/rounds.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * The sweep of the daily job (3.14): queued emails whose job died are settled, so a `sending`
 * round finishes; rows whose job may still run are never touched. Made-up employees only.
 */

const NUMBERS = ['1001', '1002', '1003'];

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let daily: ReturnType<typeof dailyReminders>;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  daily = dailyReminders(app, prisma);
});

afterAll(async () => {
  await app.close();
});

/** A round sent through the API: `sending`, one queued invitation and one job per employee. */
async function sendingRound(): Promise<string> {
  const templateId = await createTemplate(app, world.managerCookie, 'הצהרה', [world.dept[15]]);
  const draft = await createDraft(
    app,
    world.managerCookie,
    templateId,
    NUMBERS.map((n) => world.emp[n] ?? ''),
  );
  await sendRound(app, world.managerCookie, draft.id);
  return draft.id;
}

const invitesOf = (roundId: string) =>
  prisma.emailMessage.findMany({ where: { type: 'invite', assignment: { roundId } } });

/** Moves the round's email rows `minutes` into the past. */
async function age(roundId: string, minutes: number) {
  await prisma.emailMessage.updateMany({
    where: { assignment: { roundId } },
    data: { createdAt: new Date(Date.now() - minutes * 60 * 1000) },
  });
}

/** Sets the state of every job of a queue (`failed` = it died after its retries). */
async function setJobs(queueName: string, state: 'failed' | 'created' | 'active') {
  await prisma.$executeRawUnsafe(
    `UPDATE "${QUEUE_SCHEMA}".job SET state = $2::"${QUEUE_SCHEMA}".job_state WHERE name = $1`,
    queueName,
    state,
  );
}

describe('the sweep', () => {
  it('dead jobs: rows failed JOB_LOST, assignments stay pending, the round becomes active', async () => {
    const roundId = await sendingRound();
    await age(roundId, STALE_AFTER_MINUTES + 10);
    await setJobs(INVITATION_QUEUE.name, 'failed');

    const result = await daily.service.run();
    expect(result.swept).toEqual({ failed: NUMBERS.length, unconfirmed: 0, roundsFinished: 1 });
    for (const row of await invitesOf(roundId)) {
      expect(row).toMatchObject({ status: 'failed', error: 'JOB_LOST', tokenHash: null });
    }
    expect(await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).toMatchObject({
      status: 'active',
    });
    expect(await prisma.assignment.count({ where: { roundId, status: 'pending' } })).toBe(
      NUMBERS.length,
    );
    const finished = await prisma.auditLog.findMany({
      where: { action: 'round.sending_finished' },
    });
    expect(finished.map((row) => row.details)).toEqual([{ sent: 0, failed: NUMBERS.length }]);
    const failed = await prisma.auditLog.findMany({
      where: { action: 'assignment.invite_failed' },
    });
    expect(failed).toHaveLength(NUMBERS.length);
    expect(failed[0]?.details).toMatchObject({ reason: 'job_lost', providerCode: 'JOB_LOST' });
    expect(daily.calls).toHaveLength(0);
  });

  it('a stored hash: the email may have left, so sent UNCONFIRMED and the link keeps working', async () => {
    const roundId = await sendingRound();
    const [first] = await invitesOf(roundId);
    const hash = tokenHash();
    await prisma.emailMessage.update({ where: { id: first?.id ?? '' }, data: { tokenHash: hash } });
    await age(roundId, STALE_AFTER_MINUTES + 10);
    await setJobs(INVITATION_QUEUE.name, 'failed');

    const result = await daily.service.run();
    expect(result.swept).toMatchObject({ failed: NUMBERS.length - 1, unconfirmed: 1 });
    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: first?.id ?? '' } });
    expect(row).toMatchObject({ status: 'sent', error: 'UNCONFIRMED', tokenHash: hash });
    expect(
      await prisma.assignment.findUniqueOrThrow({ where: { id: first?.assignmentId ?? '' } }),
    ).toMatchObject({ status: 'sent' });
  });

  it.each(['created', 'active'] as const)(
    'a job still %s: its old row is left alone',
    async (state) => {
      const roundId = await sendingRound();
      await age(roundId, 24 * 60);
      await setJobs(INVITATION_QUEUE.name, state);
      const result = await daily.service.run();
      expect(result.swept).toEqual({ failed: 0, unconfirmed: 0, roundsFinished: 0 });
      expect((await invitesOf(roundId)).every((row) => row.status === 'queued')).toBe(true);
      expect(await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).toMatchObject({
        status: 'sending',
      });
    },
  );

  it('a row younger than the limit is left alone, even with no job', async () => {
    const roundId = await sendingRound();
    await age(roundId, STALE_AFTER_MINUTES - 10);
    await clearQueueJobs(prisma);
    expect((await daily.service.run()).swept.failed).toBe(0);
    expect((await invitesOf(roundId)).every((row) => row.status === 'queued')).toBe(true);
  });

  it('a lost reminder no longer blocks: swept, then the employee is reminded in the same run', async () => {
    const round = await sentRoundOf(app, prisma, world, NUMBERS);
    const assignmentId = round.assignment['1001'] ?? '';
    const lost = await prisma.emailMessage.create({
      data: {
        assignmentId,
        type: 'reminder',
        toEmail: 'old@example.com',
        status: 'queued',
        createdAt: new Date(Date.now() - (STALE_AFTER_MINUTES + 10) * 60 * 1000),
      },
    });
    const result = await daily.service.run({ now: inDays(1) });
    expect(result.swept.failed).toBe(1);
    expect(result.queued).toBe(NUMBERS.length);
    expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({
      status: 'failed',
      error: 'JOB_LOST',
    });
    expect(
      await prisma.emailMessage.count({
        where: { assignmentId, type: 'reminder', status: 'queued' },
      }),
    ).toBe(1);
  });

  it('signed copies are never swept', async () => {
    const round = await sentRoundOf(app, prisma, world, NUMBERS);
    const copy = await prisma.emailMessage.create({
      data: {
        assignmentId: round.assignment['1001'] ?? '',
        type: 'signed_copy',
        toEmail: 'copy@example.com',
        status: 'queued',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    await daily.service.run();
    expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: copy.id } })).toMatchObject({
      status: 'queued',
    });
  });
});
