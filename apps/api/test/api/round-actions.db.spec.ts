import { randomUUID } from 'node:crypto';
import { assignmentRowSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { INVITATION_QUEUE, REMINDER_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { createTestApp, httpServer } from '../setup/app.js';
import {
  errorOf,
  jobsOf,
  postAction,
  type SentRound,
  sentRoundOf,
  tokenHash,
} from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

/** One-employee actions (3.12): remind, resend, unlock, cancel. Made-up employees only. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SentRound;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await sentRoundOf(app, prisma, world, ['1001', '1002', '1003']);
});

afterAll(async () => {
  await app.close();
});

const idOf = (number: string) => round.assignment[number] ?? '';
const act = (number: string, action: string, cookie: string | null = world.managerCookie) =>
  postAction(app, `/api/assignments/${idOf(number)}/${action}`, cookie);
const rowOf = (number: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: idOf(number) } });
const emailsOf = (number: string) =>
  prisma.emailMessage.findMany({
    where: { assignmentId: idOf(number) },
    orderBy: { createdAt: 'asc' },
  });
const audits = (action: string) =>
  prisma.auditLog.findMany({ where: { action }, orderBy: { id: 'asc' } });

/** The 3.11 table row of one employee. */
async function tableRow(number: string) {
  const response = await request(httpServer(app))
    .get(`/api/rounds/${round.roundId}/assignments`)
    .set('Cookie', world.managerCookie);
  expect(response.status).toBe(200);
  const items = (response.body as { items: unknown[] }).items.map((item) =>
    assignmentRowSchema.parse(item),
  );
  const row = items.find(({ assignmentId }) => assignmentId === idOf(number));
  if (!row) throw new Error(`No table row for ${number}`);
  return row;
}

const ACTIONS = ['remind', 'resend', 'unlock', 'cancel'] as const;

describe('access', () => {
  it.each(ACTIONS)('%s: officer 403, signed out 401, nothing changes', async (action) => {
    const officer = await act('1001', action, world.officerCookie);
    expect(officer.status).toBe(403);
    const signedOut = await act('1001', action, null);
    expect(signedOut.status).toBe(401);
    expect(await rowOf('1001')).toMatchObject({ status: 'sent' });
    expect(await emailsOf('1001')).toHaveLength(1);
  });

  it.each(ACTIONS)('%s: unknown assignment 404, bad id 400', async (action) => {
    const unknown = await postAction(
      app,
      `/api/assignments/${randomUUID()}/${action}`,
      world.managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('ASSIGNMENT_NOT_FOUND');
    const bad = await postAction(app, `/api/assignments/not-a-uuid/${action}`, world.managerCookie);
    expect(bad.status).toBe(400);
  });

  it.each(ACTIONS)('%s: a cancelled round → 409 ROUND_NOT_OPEN', async (action) => {
    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'cancelled' } });
    const response = await act('1001', action);
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('ROUND_NOT_OPEN');
    expect(errorOf(response).message).toMatch(/\p{Script=Hebrew}/u);
  });
});

describe('remind one employee', () => {
  it('queues one reminder to her current email; the status stays, old links stay', async () => {
    const newAddress = 'fixed-1001@example.com';
    await prisma.employee.update({
      where: { id: world.emp['1001'] ?? '' },
      data: { email: newAddress, emailStatus: 'valid' },
    });
    const [invite] = await emailsOf('1001');

    const response = await act('1001', 'remind');
    expect(response.status).toBe(202);
    const body = response.body as { emailMessageId: string };
    expect(response.body).toEqual({
      assignmentId: idOf('1001'),
      roundId: round.roundId,
      emailMessageId: body.emailMessageId,
      status: 'sent',
    });

    const emails = await emailsOf('1001');
    expect(emails).toHaveLength(2);
    expect(emails[0]).toEqual(invite);
    expect(emails[1]).toMatchObject({
      id: body.emailMessageId,
      type: 'reminder',
      status: 'queued',
      toEmail: newAddress,
      tokenHash: null,
    });
    expect(await rowOf('1001')).toMatchObject({ status: 'sent', reminderCount: 0 });
    expect(await jobsOf(prisma, REMINDER_QUEUE.name)).toEqual([
      {
        data: { assignmentId: idOf('1001'), emailMessageId: body.emailMessageId },
        singletonKey: idOf('1001'),
      },
    ]);
    const [audit] = await audits('assignment.remind_queued');
    expect(audit).toMatchObject({
      userId: world.managerId,
      entityType: 'assignment',
      entityId: idOf('1001'),
      details: { roundId: round.roundId, emailMessageId: body.emailMessageId },
    });
    expect(JSON.stringify(audit?.details)).not.toContain('@');
  });

  it('a double click sends once; within the hour → REMIND_TOO_SOON with the time', async () => {
    expect((await act('1001', 'remind')).status).toBe(202);
    const second = await act('1001', 'remind');
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('EMAIL_ALREADY_QUEUED');

    // The worker sent it a few minutes ago.
    const sentAt = new Date(Date.now() - 5 * 60 * 1000);
    await prisma.emailMessage.updateMany({
      where: { assignmentId: idOf('1001'), type: 'reminder' },
      data: { status: 'sent', tokenHash: tokenHash(), createdAt: sentAt, sentAt },
    });
    await clearQueueJobs(prisma);
    const third = await act('1001', 'remind');
    expect(third.status).toBe(409);
    expect(errorOf(third).code).toBe('REMIND_TOO_SOON');
    const retryAfter = new Date(String(errorOf(third).details?.retryAfter));
    expect(retryAfter.getTime()).toBe(sentAt.getTime() + 60 * 60 * 1000);
    expect(await emailsOf('1001')).toHaveLength(2);
  });

  it('two reminds at the same moment → one 202, one 409, one email', async () => {
    const answers = await Promise.all([act('1001', 'remind'), act('1001', 'remind')]);
    expect(answers.map(({ status }) => status).sort()).toEqual([202, 409]);
    expect((await emailsOf('1001')).filter(({ type }) => type === 'reminder')).toHaveLength(1);
  });

  it.each([
    ['pending', 'ASSIGNMENT_NOT_REMINDABLE'],
    ['missing_data', 'ASSIGNMENT_NOT_REMINDABLE'],
    ['no_email', 'ASSIGNMENT_NOT_REMINDABLE'],
    ['invalid_email', 'ASSIGNMENT_NOT_REMINDABLE'],
    ['signed', 'ASSIGNMENT_ALREADY_SIGNED'],
    ['signed_manual', 'ASSIGNMENT_ALREADY_SIGNED'],
    ['cancelled', 'ASSIGNMENT_ALREADY_CANCELLED'],
  ] as const)('%s → 409 %s', async (status, code) => {
    await setState(prisma, idOf('1001'), world.managerId, { status });
    const response = await act('1001', 'remind');
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe(code);
    expect(await emailsOf('1001')).toHaveLength(1);
  });

  it('opened is reminded too', async () => {
    await setState(prisma, idOf('1001'), world.managerId, { status: 'opened' });
    expect((await act('1001', 'remind')).status).toBe(202);
  });

  it('refuses a locked row, an expired link, no valid email and a draft', async () => {
    await setState(prisma, idOf('1001'), world.managerId, { status: 'sent', locked: true });
    expect(errorOf(await act('1001', 'remind')).code).toBe('ASSIGNMENT_LOCKED');

    await prisma.employee.update({
      where: { id: world.emp['1002'] ?? '' },
      data: { emailStatus: 'bounced' },
    });
    expect(errorOf(await act('1002', 'remind')).code).toBe('EMPLOYEE_NO_VALID_EMAIL');

    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(errorOf(await act('1003', 'remind')).code).toBe('LINK_EXPIRED');

    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'draft' } });
    expect(errorOf(await act('1003', 'remind')).code).toBe('ROUND_NOT_SENT');
    expect(await prisma.emailMessage.count({ where: { type: 'reminder' } })).toBe(0);
  });
});

describe('resend', () => {
  /** "Send failed": the row is pending and its only invitation failed for good. */
  async function sendFailed(number: string) {
    await prisma.assignment.update({
      where: { id: idOf(number) },
      data: { status: 'pending', sentAt: null },
    });
    await prisma.emailMessage.updateMany({
      where: { assignmentId: idOf(number) },
      data: { status: 'failed', tokenHash: null, error: 'EENVELOPE', sentAt: null },
    });
  }

  it('after a failed send: a new invitation; "send failed" clears from the table', async () => {
    await sendFailed('1001');
    expect((await tableRow('1001')).displayStatus).toBe('send_failed');

    const response = await act('1001', 'resend');
    expect(response.status).toBe(202);
    const { emailMessageId } = response.body as { emailMessageId: string };
    expect(response.body).toMatchObject({ assignmentId: idOf('1001'), status: 'pending' });
    const emails = await emailsOf('1001');
    expect(emails.map(({ type, status }) => `${type}:${status}`)).toEqual([
      'invite:failed',
      'invite:queued',
    ]);
    expect((await tableRow('1001')).displayStatus).toBe('pending');
    expect(await jobsOf(prisma, INVITATION_QUEUE.name)).toEqual([
      { data: { assignmentId: idOf('1001'), emailMessageId }, singletonKey: idOf('1001') },
    ]);
    const [audit] = await audits('assignment.resend_queued');
    expect(audit?.details).toEqual({
      roundId: round.roundId,
      emailMessageId,
      fromStatus: 'pending',
    });
  });

  it('a wrong email must be fixed first; then the row goes back to pending', async () => {
    const [invite] = await emailsOf('1001');
    await prisma.assignment.update({
      where: { id: idOf('1001') },
      data: { status: 'invalid_email' },
    });
    await prisma.emailMessage.update({
      where: { id: invite?.id ?? '' },
      data: { status: 'bounced' },
    });

    const same = await act('1001', 'resend');
    expect(same.status).toBe(409);
    expect(errorOf(same).code).toBe('EMAIL_NOT_CHANGED');

    await prisma.employee.update({
      where: { id: world.emp['1001'] ?? '' },
      data: { email: 'corrected-1001@example.com', emailStatus: 'valid' },
    });
    const fixed = await act('1001', 'resend');
    expect(fixed.status).toBe(202);
    expect(await rowOf('1001')).toMatchObject({ status: 'pending' });
    const emails = await emailsOf('1001');
    expect(emails[1]).toMatchObject({
      type: 'invite',
      status: 'queued',
      toEmail: 'corrected-1001@example.com',
    });
    const [audit] = await audits('assignment.resend_queued');
    expect(audit?.details).toMatchObject({ fromStatus: 'invalid_email' });
  });

  it.each([
    ['sent', 'ASSIGNMENT_NOT_RESENDABLE'],
    ['opened', 'ASSIGNMENT_NOT_RESENDABLE'],
    ['no_email', 'ASSIGNMENT_NOT_RESENDABLE'],
    ['missing_data', 'ASSIGNMENT_NOT_RESENDABLE'],
    ['signed', 'ASSIGNMENT_ALREADY_SIGNED'],
    ['cancelled', 'ASSIGNMENT_ALREADY_CANCELLED'],
  ] as const)('%s → 409 %s', async (status, code) => {
    await setState(prisma, idOf('1001'), world.managerId, { status });
    const response = await act('1001', 'resend');
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe(code);
    expect(await emailsOf('1001')).toHaveLength(1);
  });

  it('a pending row whose invitation is still on its way, or never failed, is refused', async () => {
    await prisma.assignment.update({ where: { id: idOf('1001') }, data: { status: 'pending' } });
    expect(errorOf(await act('1001', 'resend')).code).toBe('ASSIGNMENT_NOT_RESENDABLE');
    await prisma.emailMessage.updateMany({
      where: { assignmentId: idOf('1001') },
      data: { status: 'queued', tokenHash: null },
    });
    expect(errorOf(await act('1001', 'resend')).code).toBe('EMAIL_ALREADY_QUEUED');
  });
});

describe('unlock', () => {
  const lock = (number: string) =>
    setState(prisma, idOf(number), world.managerId, { status: 'opened', locked: true });

  it('clears the lock and the attempts; the table no longer shows "locked"', async () => {
    await lock('1001');
    expect((await tableRow('1001')).displayStatus).toBe('locked');
    const lockedAt = (await rowOf('1001')).lockedAt;

    const response = await act('1001', 'unlock');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      assignmentId: idOf('1001'),
      roundId: round.roundId,
      status: 'opened',
      unlocksLeft: 1,
    });
    expect(await rowOf('1001')).toMatchObject({
      status: 'opened',
      lockedAt: null,
      failedAttempts: 0,
    });
    const row = await tableRow('1001');
    expect(row.displayStatus).toBe('opened');
    expect(row.locked).toBe(false);

    // Who and when, the count of attempts, never the numbers typed.
    const [audit] = await audits('assignment.unlocked');
    expect(audit).toMatchObject({ userId: world.managerId, entityId: idOf('1001') });
    expect(audit?.details).toEqual({
      roundId: round.roundId,
      lockedAt: lockedAt?.toISOString(),
      failedAttempts: 5,
      previousUnlocks: 0,
    });
  });

  it('at most twice: the third unlock → 409 UNLOCK_LIMIT_REACHED, still locked', async () => {
    await lock('1001');
    expect((await act('1001', 'unlock')).body).toMatchObject({ unlocksLeft: 1 });
    await lock('1001');
    expect((await act('1001', 'unlock')).body).toMatchObject({ unlocksLeft: 0 });
    await lock('1001');
    const third = await act('1001', 'unlock');
    expect(third.status).toBe(409);
    expect(errorOf(third).code).toBe('UNLOCK_LIMIT_REACHED');
    expect(errorOf(third).details).toEqual({ unlocks: 2 });
    expect(errorOf(third).message).toContain('במשרד');
    expect(await rowOf('1001')).toMatchObject({ failedAttempts: 5 });
    expect((await rowOf('1001')).lockedAt).not.toBeNull();
    // Another employee has her own count.
    await lock('1002');
    expect((await act('1002', 'unlock')).status).toBe(200);
  });

  it('two unlocks at once → one 200, one 409, one audit row', async () => {
    await lock('1001');
    const answers = await Promise.all([act('1001', 'unlock'), act('1001', 'unlock')]);
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(await audits('assignment.unlocked')).toHaveLength(1);
  });

  it('refuses a row that is not locked and an expired link', async () => {
    expect(errorOf(await act('1001', 'unlock')).code).toBe('ASSIGNMENT_NOT_LOCKED');
    await lock('1002');
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(errorOf(await act('1002', 'unlock')).code).toBe('LINK_EXPIRED');
    expect(await audits('assignment.unlocked')).toHaveLength(0);
  });
});

describe('cancel one employee', () => {
  it('cancels; the table reads "cancelled", not "inactive at send"; links keep their hash', async () => {
    const before = await emailsOf('1001');
    const response = await act('1001', 'cancel');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      assignmentId: idOf('1001'),
      roundId: round.roundId,
      status: 'cancelled',
    });
    const row = await rowOf('1001');
    expect(row.status).toBe('cancelled');
    expect(row.cancelledAt).not.toBeNull();
    expect(row.cancelledAt?.getTime()).not.toBe(row.sentAt?.getTime());
    const table = await tableRow('1001');
    expect(table.displayStatus).toBe('cancelled');
    expect(table.cancelReason).toBe('cancelled');
    // 3.13 finds each link by its hash and shows "cancelled" from the assignment's status.
    expect(await emailsOf('1001')).toEqual(before);
    expect(before.every(({ tokenHash: hash }) => hash !== null)).toBe(true);
    const [audit] = await audits('assignment.cancelled');
    expect(audit?.details).toEqual({ roundId: round.roundId, fromStatus: 'sent' });
    // The others are untouched.
    expect(await rowOf('1002')).toMatchObject({ status: 'sent' });
  });

  it('a second cancel → 409; a signed one → 409 ASSIGNMENT_ALREADY_SIGNED', async () => {
    expect((await act('1001', 'cancel')).status).toBe(200);
    expect(errorOf(await act('1001', 'cancel')).code).toBe('ASSIGNMENT_ALREADY_CANCELLED');
    await setState(prisma, idOf('1002'), world.managerId, { status: 'signed' });
    expect(errorOf(await act('1002', 'cancel')).code).toBe('ASSIGNMENT_ALREADY_SIGNED');
    expect(await rowOf('1002')).toMatchObject({ status: 'signed' });
  });

  it.each(['pending', 'opened', 'missing_data', 'no_email', 'invalid_email'] as const)(
    '%s can be cancelled',
    async (status) => {
      await setState(prisma, idOf('1001'), world.managerId, { status });
      expect((await act('1001', 'cancel')).status).toBe(200);
      expect(await rowOf('1001')).toMatchObject({ status: 'cancelled' });
    },
  );

  it('also when locked, expired, or in a draft', async () => {
    await setState(prisma, idOf('1001'), world.managerId, { status: 'sent', locked: true });
    expect((await act('1001', 'cancel')).status).toBe(200);
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await act('1002', 'cancel')).status).toBe(200);
    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'draft' } });
    await prisma.assignment.update({ where: { id: idOf('1003') }, data: { status: 'pending' } });
    expect((await act('1003', 'cancel')).status).toBe(200);
  });
});
