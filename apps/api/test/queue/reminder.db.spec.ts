import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service.js';
import type { SendResult } from '../../src/common/email/email.adapter.js';
import { EmailSendError } from '../../src/common/email/email.errors.js';
import type { EmailService, SigningEmailInput } from '../../src/common/email/email.service.js';
import { hashSigningToken } from '../../src/common/email/signing-token.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import type { InvitationJobData } from '../../src/common/queue/queue.definitions.js';
import type { JobContext } from '../../src/common/queue/queue.service.js';
import { RoundSendRepository } from '../../src/modules/rounds/round-send.repository.js';
import { SigningEmailSender } from '../../src/modules/rounds/signing-email-sender.service.js';
import { createTestApp } from '../setup/app.js';
import { messagesTo } from '../setup/mailpit.js';
import { postAction, type SentRound, sentRoundOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

/** The reminder job (3.12): the 3.10 steps for a reminder row. Made-up employees only. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SentRound;
let worker: INestApplicationContext | undefined;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await sentRoundOf(app, prisma, world, ['1001', '1002']);
});

afterEach(async () => {
  if (worker) await closeTestWorker(worker);
  worker = undefined;
});

afterAll(async () => {
  await app.close();
});

const idOf = (number: string) => round.assignment[number] ?? '';
const rowOf = (number: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: idOf(number) } });
const reread = (id: string) => prisma.emailMessage.findUniqueOrThrow({ where: { id } });

/** Queues a reminder through the API (202) and returns its row id. */
async function remind(number: string): Promise<string> {
  const response = await postAction(
    app,
    `/api/assignments/${idOf(number)}/remind`,
    world.managerCookie,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return (response.body as { emailMessageId: string }).emailMessageId;
}

function jobOf(number: string, emailMessageId: string, isLastAttempt = false) {
  return {
    id: `job-${emailMessageId}`,
    data: { assignmentId: idOf(number), emailMessageId },
    attempt: 1,
    isLastAttempt,
    signal: new AbortController().signal,
  } satisfies JobContext<InvitationJobData>;
}

/** An EmailService stand-in for reminders; an invitation call would fail the test. */
function stubEmail(answer?: () => Promise<SendResult>) {
  const calls: SigningEmailInput[] = [];
  const service = {
    sendReminder: (input: SigningEmailInput) => {
      calls.push(input);
      return answer ? answer() : Promise.resolve({ providerMessageId: '<r1@test>' });
    },
  };
  const sender = new SigningEmailSender(
    prisma,
    app.get(RoundSendRepository, { strict: false }),
    service as unknown as EmailService,
    app.get(AuditService),
  );
  return { calls, sender };
}

describe('the reminder job', () => {
  it('sends with a new token, counts the reminder and keeps the status', async () => {
    const id = await remind('1001');
    const { calls, sender } = stubEmail();
    await sender.run(jobOf('1001', id));

    expect(calls).toHaveLength(1);
    const row = await reread(id);
    expect(row).toMatchObject({ status: 'sent', error: null, providerMessageId: '<r1@test>' });
    expect(row.tokenHash).toBe(hashSigningToken(calls[0]?.token ?? ''));
    const assignment = await rowOf('1001');
    expect(assignment).toMatchObject({ status: 'sent', reminderCount: 1 });
    expect(assignment.lastReminderAt).not.toBeNull();
    // The invitation's link is still there, with its own hash.
    const invite = await prisma.emailMessage.findFirstOrThrow({
      where: { assignmentId: idOf('1001'), type: 'invite' },
    });
    expect(invite.tokenHash).not.toBe(row.tokenHash);
    const [audit] = await prisma.auditLog.findMany({
      where: { action: 'assignment.reminder_sent' },
    });
    expect(audit?.details).toEqual({
      roundId: round.roundId,
      emailMessageId: id,
      unconfirmed: false,
      providerCode: null,
    });
  });

  it('run twice: one email, counted once', async () => {
    const id = await remind('1001');
    const { calls, sender } = stubEmail();
    await sender.run(jobOf('1001', id));
    await sender.run(jobOf('1001', id));
    expect(calls).toHaveLength(1);
    expect(await rowOf('1001')).toMatchObject({ reminderCount: 1 });
  });

  it('maybe sent → UNCONFIRMED, counted, not sent again', async () => {
    const id = await remind('1001');
    const { calls, sender } = stubEmail(() =>
      Promise.reject(new EmailSendError('temporary', 'ETIMEDOUT', 'maybe_sent')),
    );
    await sender.run(jobOf('1001', id));
    await sender.run(jobOf('1001', id));
    expect(calls).toHaveLength(1);
    expect(await reread(id)).toMatchObject({ status: 'sent', error: 'UNCONFIRMED:ETIMEDOUT' });
    expect(await rowOf('1001')).toMatchObject({ status: 'sent', reminderCount: 1 });
  });
});

describe('the reminder job: when it may no longer go, or fails', () => {
  it('a permanent refusal → failed, the assignment becomes invalid_email, not counted', async () => {
    const id = await remind('1001');
    const { sender } = stubEmail(() =>
      Promise.reject(new EmailSendError('permanent', '550', 'not_sent')),
    );
    await sender.run(jobOf('1001', id));
    expect(await reread(id)).toMatchObject({ status: 'failed', tokenHash: null, error: '550' });
    expect(await rowOf('1001')).toMatchObject({ status: 'invalid_email', reminderCount: 0 });
    const [audit] = await prisma.auditLog.findMany({
      where: { action: 'assignment.reminder_failed' },
    });
    expect(audit?.details).toMatchObject({ reason: 'permanent', providerCode: '550' });
  });

  const closers: [string, (number: string) => Promise<unknown>][] = [
    ['signed', (n) => setState(prisma, idOf(n), world.managerId, { status: 'signed' })],
    ['cancelled', (n) => setState(prisma, idOf(n), world.managerId, { status: 'cancelled' })],
    ['locked', (n) => setState(prisma, idOf(n), world.managerId, { status: 'sent', locked: true })],
    [
      'expired',
      () =>
        prisma.round.update({
          where: { id: round.roundId },
          data: { linkExpiresAt: new Date(Date.now() - 1000) },
        }),
    ],
    [
      'round cancelled',
      () => prisma.round.update({ where: { id: round.roundId }, data: { status: 'cancelled' } }),
    ],
  ];

  it.each(closers)(
    '%s after queuing → failed ASSIGNMENT_CLOSED, nothing sent',
    async (_, close) => {
      const id = await remind('1001');
      await close('1001');
      const { calls, sender } = stubEmail();
      await sender.run(jobOf('1001', id));
      expect(calls).toHaveLength(0);
      expect(await reread(id)).toMatchObject({
        status: 'failed',
        error: 'ASSIGNMENT_CLOSED',
        tokenHash: null,
      });
      expect(await rowOf('1001')).toMatchObject({ reminderCount: 0 });
    },
  );

  it('the real worker sends the reminder to Mailpit with its own link', async () => {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: world.emp['1002'] ?? '' },
    });
    const id = await remind('1002');
    worker = await createTestWorker();
    await waitFor(async () => ((await reread(id)).status === 'sent' ? true : undefined));
    const [message] = await messagesTo(employee.email ?? '', 1);
    expect(message?.Subject).toContain('תזכורת');
    const link = /\/sign\/([A-Za-z0-9_-]{43})/.exec(message?.Text ?? '');
    expect(link).not.toBeNull();
    expect((await reread(id)).tokenHash).toBe(hashSigningToken(link?.[1] ?? ''));
    expect(await rowOf('1002')).toMatchObject({ reminderCount: 1 });
  });
});
