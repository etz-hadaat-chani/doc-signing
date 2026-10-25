import { randomUUID } from 'node:crypto';
import { todayInIsrael } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { REMINDER_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { QueueService } from '../../src/common/queue/queue.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { dailyReminders, inDays } from '../setup/daily-reminders.js';
import { jobsOf, postAction, type SentRound, sentRoundOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * The daily reminder job (3.14): who is due and how often. The round was sent two days ago
 * (`sentRoundOf`), interval 3: due from `inDays(1)` on. Made-up employees only.
 */

const NUMBERS = ['1001', '1002', '1003', '1004', '1005', '1006'];

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SentRound;
let daily: ReturnType<typeof dailyReminders>;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await sentRoundOf(app, prisma, world, NUMBERS);
  daily = dailyReminders(app, prisma);
});

afterAll(async () => {
  await app.close();
});

const idOf = (number: string) => round.assignment[number] ?? '';
const queuedReminders = () =>
  prisma.emailMessage.findMany({ where: { type: 'reminder', status: 'queued' } });
const remindedNumbers = async () => {
  const rows = await prisma.emailMessage.findMany({
    where: { type: 'reminder' },
    select: { assignment: { select: { employee: { select: { employeeNumber: true } } } } },
  });
  return rows.map((row) => row.assignment.employee.employeeNumber).sort();
};
const setRound = (data: Parameters<PrismaService['round']['update']>[0]['data']) =>
  prisma.round.update({ where: { id: round.roundId }, data });

describe('who is due', () => {
  it('reminds sent and opened rows once the interval has passed, ids only in the job', async () => {
    await setState(prisma, idOf('1002'), world.managerId, { status: 'opened' });
    expect((await daily.service.run({ now: inDays(0) })).queued).toBe(0);
    expect(await queuedReminders()).toHaveLength(0);

    const result = await daily.service.run({ now: inDays(1) });
    expect(result.queued).toBe(NUMBERS.length);
    expect(result.byRound).toEqual([{ roundId: round.roundId, queued: NUMBERS.length }]);
    const rows = await queuedReminders();
    expect(rows).toHaveLength(NUMBERS.length);
    expect(rows.every((row) => row.tokenHash === null)).toBe(true);
    const jobs = await jobsOf(prisma, REMINDER_QUEUE.name);
    expect(jobs).toHaveLength(NUMBERS.length);
    for (const job of jobs) {
      expect(Object.keys(job.data as object).sort()).toEqual(['assignmentId', 'emailMessageId']);
      expect(job.singletonKey).toBe((job.data as { assignmentId: string }).assignmentId);
    }
  });

  it('goes to the current valid email', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1001'] ?? '' },
      data: { email: 'new.1001@example.com', emailStatus: 'valid' },
    });
    await daily.service.run({ now: inDays(1) });
    const row = await prisma.emailMessage.findFirstOrThrow({
      where: { type: 'reminder', assignmentId: idOf('1001') },
    });
    expect(row.toEmail).toBe('new.1001@example.com');
  });

  it('skips signed, cancelled, locked, no valid email; never pending, missing_data, no_email, invalid_email', async () => {
    await setState(prisma, idOf('1001'), world.managerId, { status: 'signed' });
    await setState(prisma, idOf('1002'), world.managerId, { status: 'cancelled' });
    await setState(prisma, idOf('1003'), world.managerId, { status: 'sent', locked: true });
    await prisma.employee.update({
      where: { id: world.emp['1004'] ?? '' },
      data: { emailStatus: 'bounced' },
    });
    await prisma.assignment.update({ where: { id: idOf('1005') }, data: { status: 'pending' } });
    await prisma.assignment.update({
      where: { id: idOf('1006') },
      data: { status: 'invalid_email' },
    });
    const result = await daily.service.run({ now: inDays(5) });
    expect(result.queued).toBe(0);
    expect(result.notReminded).toMatchObject({ locked: 1, noValidEmail: 1 });
    for (const status of ['missing_data', 'no_email'] as const) {
      await prisma.assignment.update({ where: { id: idOf('1005') }, data: { status } });
      expect((await daily.service.run({ now: inDays(5) })).queued).toBe(0);
    }
    expect(await queuedReminders()).toHaveLength(0);
  });

  it.each([
    ['the link expired', { linkExpiresAt: new Date(Date.now() - 1000) }],
    ['reminders are off', { remindersEnabled: false }],
    ['the round is closed', { status: 'closed' as const }],
    ['the round is cancelled', { status: 'cancelled' as const }],
  ])('nobody when %s', async (_, data) => {
    await setRound(data);
    const result = await daily.service.run({ now: inDays(5) });
    expect(result).toMatchObject({ queued: 0, rounds: 0 });
    expect(await queuedReminders()).toHaveLength(0);
  });

  it('a sending round is reminded too', async () => {
    await setRound({ status: 'sending' });
    expect((await daily.service.run({ now: inDays(1) })).queued).toBe(NUMBERS.length);
  });

  it('follows the round interval', async () => {
    await setRound({ reminderIntervalDays: 5 });
    expect((await daily.service.run({ now: inDays(2) })).queued).toBe(0);
    expect((await daily.service.run({ now: inDays(3) })).queued).toBe(NUMBERS.length);
  });

  it('the next reminder waits for the interval after the last one', async () => {
    await daily.service.run({ now: inDays(1) });
    expect(await daily.sendQueued()).toBe(NUMBERS.length);
    // The reminders went out today (database clock): counted from today, not from the send.
    expect((await daily.service.run({ now: inDays(2) })).notReminded.notDue).toBe(NUMBERS.length);
    expect((await daily.service.run({ now: inDays(3) })).queued).toBe(NUMBERS.length);
  });

  it('respects max_reminders, and a manual reminder counts', async () => {
    await setRound({ maxReminders: 1 });
    const manual = await postAction(
      app,
      `/api/assignments/${idOf('1001')}/remind`,
      world.managerCookie,
    );
    expect(manual.status).toBe(202);
    await daily.sendQueued();
    expect(
      await prisma.assignment.findUniqueOrThrow({ where: { id: idOf('1001') } }),
    ).toMatchObject({ reminderCount: 1 });
    const result = await daily.service.run({ now: inDays(5) });
    expect(result.queued).toBe(NUMBERS.length - 1);
    expect(result.notReminded.maxReached).toBe(1);
    await daily.sendQueued();
    expect((await daily.service.run({ now: inDays(10) })).notReminded.maxReached).toBe(
      NUMBERS.length,
    );
  });

  it('no limit by default: the 20th reminder still goes', async () => {
    await setState(prisma, idOf('1001'), world.managerId, {
      status: 'sent',
      reminderCount: 19,
      at: inDays(-5),
    });
    await daily.service.run({ now: inDays(1) });
    expect(await remindedNumbers()).toContain('1001');
  });
});

describe('safe to run twice', () => {
  it('twice the same day: one reminder per employee', async () => {
    const first = await daily.service.run({ now: inDays(1) });
    const second = await daily.service.run({ now: inDays(1) });
    expect(first.queued).toBe(NUMBERS.length);
    expect(second.queued).toBe(0);
    expect(second.notReminded.emailQueued).toBe(NUMBERS.length);
    await daily.sendQueued();
    const third = await daily.service.run({ now: inDays(1) });
    expect(third.queued).toBe(0);
    expect(third.notReminded.notDue).toBe(NUMBERS.length);
    expect(await remindedNumbers()).toEqual(NUMBERS);
    expect(daily.calls).toHaveLength(NUMBERS.length);
  });

  it('two runs at the same time (×5): still one reminder per employee', async () => {
    for (let i = 0; i < 5; i += 1) {
      await prisma.emailMessage.deleteMany({ where: { type: 'reminder' } });
      await clearQueueJobs(prisma);
      const results = await Promise.all([
        daily.service.run({ now: inDays(1) }),
        daily.service.run({ now: inDays(1) }),
      ]);
      expect(results.map((r) => r.queued).sort()).toEqual([0, NUMBERS.length]);
      expect(await remindedNumbers()).toEqual(NUMBERS);
    }
  });

  it('a run and a manager reminding the round at once: one reminder each', async () => {
    const [run, manual] = await Promise.all([
      daily.service.run({ now: inDays(1) }),
      postAction(app, `/api/rounds/${round.roundId}/remind`, world.managerCookie),
    ]);
    expect(manual.status).toBe(202);
    const manualQueued = (manual.body as { queued: number }).queued;
    expect(run.queued + manualQueued).toBe(NUMBERS.length);
    expect(await remindedNumbers()).toEqual(NUMBERS);
  });

  it("an employee whose previous reminder job is still busy doesn't hold back the others", async () => {
    // A job for 1001 still waiting on the exclusive queue, with no queued row (it is finishing).
    await app
      .get(QueueService)
      .send(
        REMINDER_QUEUE,
        { assignmentId: idOf('1001'), emailMessageId: randomUUID() },
        { singletonKey: idOf('1001') },
      );
    const result = await daily.service.run({ now: inDays(1) });
    expect(result.queued).toBe(NUMBERS.length - 1);
    expect(result.notReminded.busy).toBe(1);
    expect(await remindedNumbers()).toEqual(NUMBERS.filter((n) => n !== '1001'));
  });
});

describe('no-reminder dates', () => {
  async function setSkipDates(days: string[]) {
    const response = await request(httpServer(app))
      .patch('/api/settings')
      .set('Cookie', world.managerCookie)
      .send({ reminderSkipDates: days });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  it('nothing on a listed date; the next day everyone due is reminded', async () => {
    await setSkipDates([todayInIsrael(inDays(3))]);
    const skipped = await daily.service.run({ now: inDays(3) });
    expect(skipped).toMatchObject({ skipped: 'skip_date', queued: 0, rounds: 0 });
    expect(await queuedReminders()).toHaveLength(0);
    const next = await daily.service.run({ now: inDays(4) });
    expect(next).toMatchObject({ skipped: null, queued: NUMBERS.length });
  });

  it("a manager's reminder still goes on a listed date", async () => {
    await setSkipDates([todayInIsrael()]);
    const manual = await postAction(
      app,
      `/api/rounds/${round.roundId}/remind`,
      world.managerCookie,
    );
    expect(manual.status).toBe(202);
    expect((manual.body as { queued: number }).queued).toBe(NUMBERS.length);
  });
});

describe('the audit row', () => {
  it('one system row per run, counts and ids only', async () => {
    await setState(prisma, idOf('1003'), world.managerId, { status: 'sent', locked: true });
    await daily.service.run({ now: inDays(1), trigger: 'manual' });
    await daily.service.run({ now: inDays(1) });
    const all = await prisma.auditLog.findMany({ where: { action: 'reminders.daily_run' } });
    expect(all).toHaveLength(2);
    const triggerOf = (row: (typeof all)[number]) => (row.details as { trigger: string }).trigger;
    const rows = [
      all.find((row) => triggerOf(row) === 'manual'),
      all.find((row) => triggerOf(row) === 'schedule'),
    ];
    expect(rows[0]).toMatchObject({ actorType: 'system', entityType: 'job', entityId: null });
    expect(rows[0]?.details).toEqual({
      trigger: 'manual',
      day: todayInIsrael(inDays(1)),
      skipped: null,
      rounds: 1,
      queued: NUMBERS.length - 1,
      notReminded: {
        locked: 1,
        noValidEmail: 0,
        emailQueued: 0,
        maxReached: 0,
        notDue: 0,
        busy: 0,
      },
      byRound: [{ roundId: round.roundId, queued: NUMBERS.length - 1 }],
      swept: { failed: 0, unconfirmed: 0, roundsFinished: 0 },
    });
    expect(rows[1]?.details).toMatchObject({ trigger: 'schedule', queued: 0, byRound: [] });
    const employees = await prisma.employee.findMany({ where: { email: { not: null } } });
    const text = JSON.stringify(all.map((row) => row.details));
    for (const employee of employees) {
      expect(text).not.toContain(employee.email ?? '');
      expect(text).not.toContain(employee.lastName);
      expect(text).not.toContain(employee.idNumber);
    }
  });
});
