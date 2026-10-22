import { randomUUID } from 'node:crypto';
import { recipientsPreviewReportSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service.js';
import type { EmailService } from '../../src/common/email/email.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { REMINDER_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { RoundSendRepository } from '../../src/modules/rounds/round-send.repository.js';
import { SigningEmailSender } from '../../src/modules/rounds/signing-email-sender.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import {
  errorOf,
  jobsOf,
  postAction,
  type SentRound,
  sentRoundOf,
} from '../setup/round-actions.js';
import { createDraft, type RoundsWorld, seedRoundsWorld, sendRound } from '../setup/rounds.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

/** Whole-round actions (3.12): remind everyone now, cancel the round. Made-up employees only. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SentRound;

const NUMBERS = ['1001', '1002', '1003', '1004', '1005', '1006'];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await sentRoundOf(app, prisma, world, NUMBERS);
});

afterAll(async () => {
  await app.close();
});

const idOf = (number: string) => round.assignment[number] ?? '';
const onRound = (action: string, roundId = round.roundId, cookie = world.managerCookie) =>
  postAction(app, `/api/rounds/${roundId}/${action}`, cookie);
const statusOf = async (number: string) =>
  (await prisma.assignment.findUniqueOrThrow({ where: { id: idOf(number) } })).status;
const audits = (action: string) =>
  prisma.auditLog.findMany({ where: { action }, orderBy: { id: 'asc' } });

/** Adds a reminder row of an assignment: sent at `at`, or still queued. */
async function addReminder(number: string, kind: 'sent' | 'queued', at = new Date()) {
  await prisma.emailMessage.create({
    data: {
      assignmentId: idOf(number),
      type: 'reminder',
      toEmail: 'someone@example.com',
      status: kind,
      tokenHash: kind === 'sent' ? randomUUID().replaceAll('-', '').padEnd(64, '0') : null,
      createdAt: at,
      sentAt: kind === 'sent' ? at : null,
    },
  });
}

describe('remind the whole round', () => {
  it('reminds who is due and counts every skip; a second click queues nothing', async () => {
    await setState(prisma, idOf('1001'), world.managerId, { status: 'sent', locked: true });
    await prisma.employee.update({
      where: { id: world.emp['1002'] ?? '' },
      data: { email: null, emailStatus: 'missing' },
    });
    await addReminder('1003', 'sent', new Date(Date.now() - 2 * 60 * 60 * 1000));
    await addReminder('1004', 'queued');
    await setState(prisma, idOf('1005'), world.managerId, { status: 'opened' });
    await setState(prisma, idOf('1006'), world.managerId, { status: 'signed' });

    const first = await onRound('remind');
    expect(first.status).toBe(202);
    expect(first.body).toEqual({
      roundId: round.roundId,
      queued: 1,
      skipped: { locked: 1, noValidEmail: 1, emailQueued: 1, recentlyEmailed: 1 },
    });
    const queued = await prisma.emailMessage.findMany({
      where: { type: 'reminder', status: 'queued' },
    });
    expect(queued.map(({ assignmentId }) => assignmentId).sort()).toEqual(
      [idOf('1004'), idOf('1005')].sort(),
    );
    const jobs = await jobsOf(prisma, REMINDER_QUEUE.name);
    expect(jobs.map(({ singletonKey }) => singletonKey)).toEqual([idOf('1005')]);
    const [audit] = await audits('round.remind_queued');
    expect(audit).toMatchObject({ entityType: 'round', entityId: round.roundId });
    expect(audit?.details).toEqual({
      queued: 1,
      skipped: { locked: 1, noValidEmail: 1, emailQueued: 1, recentlyEmailed: 1 },
    });

    const second = await onRound('remind');
    expect(second.status).toBe(202);
    expect(second.body).toMatchObject({ queued: 0, skipped: { emailQueued: 2 } });
    expect(await prisma.emailMessage.count({ where: { type: 'reminder' } })).toBe(3);
  });

  it('refuses a draft, a cancelled round and an expired one; officer 403', async () => {
    expect((await onRound('remind', round.roundId, world.officerCookie)).status).toBe(403);
    expect((await onRound('remind', randomUUID())).status).toBe(404);
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(errorOf(await onRound('remind')).code).toBe('LINK_EXPIRED');
    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'draft' } });
    expect(errorOf(await onRound('remind')).code).toBe('ROUND_NOT_SENT');
    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'cancelled' } });
    expect(errorOf(await onRound('remind')).code).toBe('ROUND_NOT_OPEN');
    expect(await prisma.emailMessage.count({ where: { type: 'reminder' } })).toBe(0);
  });
});

describe('cancel the whole round', () => {
  it('cancels every open row; signed ones stay; a second cancel → 409', async () => {
    await setState(prisma, idOf('1001'), world.managerId, { status: 'signed' });
    await setState(prisma, idOf('1002'), world.managerId, { status: 'opened', locked: true });
    await setState(prisma, idOf('1003'), world.managerId, { status: 'no_email' });

    expect((await onRound('cancel', round.roundId, world.officerCookie)).status).toBe(403);
    const response = await onRound('cancel');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      roundId: round.roundId,
      status: 'cancelled',
      cancelled: 5,
      signedUntouched: 1,
    });
    expect(await statusOf('1001')).toBe('signed');
    for (const number of NUMBERS.slice(1)) expect(await statusOf(number)).toBe('cancelled');
    const rows = await prisma.assignment.findMany({ where: { roundId: round.roundId } });
    expect(rows.filter(({ cancelledAt }) => cancelledAt !== null)).toHaveLength(5);
    expect((await prisma.round.findUniqueOrThrow({ where: { id: round.roundId } })).status).toBe(
      'cancelled',
    );
    const [audit] = await audits('round.cancelled');
    expect(audit?.details).toEqual({
      fromStatus: 'active',
      cancelled: 5,
      byStatus: { sent: 3, opened: 1, no_email: 1 },
      signedUntouched: 1,
    });

    const again = await onRound('cancel');
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('ROUND_NOT_OPEN');
  });

  it('frees the employees at once: the same document can go to them in a new round', async () => {
    const preview = async () => {
      const response = await request(httpServer(app))
        .post('/api/rounds/recipients-preview')
        .set('Cookie', world.managerCookie)
        .send({
          mode: 'single_template',
          templateId: round.templateId,
          recipients: { employeeIds: NUMBERS.map((n) => world.emp[n] ?? '') },
        });
      expect(response.status).toBe(200);
      return recipientsPreviewReportSchema.parse(response.body).counts;
    };
    expect(await preview()).toMatchObject({ alreadyOpen: 6, inRound: 0 });
    expect((await onRound('cancel')).status).toBe(200);
    expect(await preview()).toMatchObject({ alreadyOpen: 0, inRound: 6 });
  });

  it('a draft can be cancelled (there is no edit or delete)', async () => {
    const draft = await createDraft(app, world.managerCookie, round.templateId, [
      world.emp['1007'] ?? '',
    ]);
    const response = await onRound('cancel', draft.id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cancelled: 1, signedUntouched: 0 });
    const [row] = await prisma.assignment.findMany({ where: { roundId: draft.id } });
    expect(row).toMatchObject({ status: 'cancelled' });
    const [audit] = await audits('round.cancelled');
    expect(audit?.details).toMatchObject({ fromStatus: 'draft', byStatus: { pending: 1 } });
    // A cancelled draft can't be sent any more.
    const send = await postAction(app, `/api/rounds/${draft.id}/send`, world.managerCookie).send(
      {},
    );
    expect(send.status).toBe(409);
    expect(errorOf(send).code).toBe('ROUND_NOT_DRAFT');
  });

  it('a sending round: its queued invitations settle as failed by themselves, nothing goes out', async () => {
    const draft = await createDraft(app, world.managerCookie, round.templateId, [
      world.emp['1007'] ?? '',
      world.emp['1008'] ?? '',
    ]);
    await sendRound(app, world.managerCookie, draft.id);
    const invites = await prisma.emailMessage.findMany({
      where: { assignment: { roundId: draft.id } },
    });
    expect(invites.map(({ status }) => status)).toEqual(['queued', 'queued']);

    const response = await onRound('cancel', draft.id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cancelled: 2 });

    // The jobs run after the cancel (a stand-in EmailService records any send).
    const calls: unknown[] = [];
    const email = {
      sendInvitation: (input: unknown) => {
        calls.push(input);
        return Promise.resolve({ providerMessageId: '<x@test>' });
      },
    };
    const sender = new SigningEmailSender(
      prisma,
      app.get(RoundSendRepository, { strict: false }),
      email as unknown as EmailService,
      app.get(AuditService),
    );
    for (const invite of invites) {
      await sender.run({
        id: `job-${invite.id}`,
        data: { assignmentId: invite.assignmentId, emailMessageId: invite.id },
        attempt: 1,
        isLastAttempt: false,
        signal: new AbortController().signal,
      });
    }
    expect(calls).toHaveLength(0);
    const settled = await prisma.emailMessage.findMany({
      where: { assignment: { roundId: draft.id } },
    });
    expect(settled.map(({ status, error }) => `${status}:${String(error)}`)).toEqual([
      'failed:ASSIGNMENT_CLOSED',
      'failed:ASSIGNMENT_CLOSED',
    ]);
    expect((await prisma.round.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      'cancelled',
    );
  });
});

describe('two managers at once', () => {
  it('two cancels of one round: one 200, one 409, one audit row (×5)', async () => {
    for (let run = 0; run < 5; run += 1) {
      const other = await sentRoundOf(app, prisma, world, ['1007', '1008']);
      const answers = await Promise.all([
        onRound('cancel', other.roundId),
        onRound('cancel', other.roundId),
      ]);
      expect(answers.map(({ status }) => status).sort()).toEqual([200, 409]);
      const rows = await audits('round.cancelled');
      expect(rows.filter(({ entityId }) => entityId === other.roundId)).toHaveLength(1);
    }
  });

  it('cancel while a remind is queued: the cancel always wins, nothing is sent (×5)', async () => {
    for (let run = 0; run < 5; run += 1) {
      const other = await sentRoundOf(app, prisma, world, ['1007', '1008']);
      const [remind, cancel] = await Promise.all([
        onRound('remind', other.roundId),
        onRound('cancel', other.roundId),
      ]);
      expect(cancel.status).toBe(200);
      expect([202, 409]).toContain(remind.status);
      if (remind.status === 409) expect(errorOf(remind).code).toBe('ROUND_NOT_OPEN');
      const rows = await prisma.assignment.findMany({ where: { roundId: other.roundId } });
      expect(rows.map(({ status }) => status)).toEqual(['cancelled', 'cancelled']);
      // A reminder queued just before the cancel finds its row cancelled when its job runs.
      const reminders = await prisma.emailMessage.findMany({
        where: { type: 'reminder', assignment: { roundId: other.roundId } },
      });
      expect(reminders.every(({ status }) => status === 'queued')).toBe(true);
      expect(reminders).toHaveLength(remind.status === 202 ? 2 : 0);
    }
  });

  it('a one-employee cancel and a round cancel at once: both end cancelled, no 500', async () => {
    const answers = await Promise.all([
      postAction(app, `/api/assignments/${idOf('1001')}/cancel`, world.managerCookie),
      onRound('cancel'),
    ]);
    for (const answer of answers) expect([200, 409]).toContain(answer.status);
    expect(answers[1].status).toBe(200);
    expect(await statusOf('1001')).toBe('cancelled');
  });
});
