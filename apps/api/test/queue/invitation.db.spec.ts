import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service.js';
import type { SendResult } from '../../src/common/email/email.adapter.js';
import { EmailSendError } from '../../src/common/email/email.errors.js';
import { EmailService, type InvitationEmailInput } from '../../src/common/email/email.service.js';
import { hashSigningToken } from '../../src/common/email/signing-token.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import {
  INVITATION_QUEUE,
  type InvitationJobData,
  QUEUE_SCHEMA,
} from '../../src/common/queue/queue.definitions.js';
import type { JobContext } from '../../src/common/queue/queue.service.js';
import { InvitationSender } from '../../src/modules/rounds/invitation-sender.service.js';
import { RoundSendRepository } from '../../src/modules/rounds/round-send.repository.js';
import { createTestApp } from '../setup/app.js';
import { messagesTo } from '../setup/mailpit.js';
import {
  createDraft,
  createTemplate,
  freshEmail,
  type RoundsWorld,
  seedRoundsWorld,
  sendRound,
} from '../setup/rounds.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

let app: INestApplication;
let prisma: PrismaService;
let repository: RoundSendRepository;
let world: RoundsWorld;
let worker: INestApplicationContext | undefined;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  repository = app.get(RoundSendRepository, { strict: false });
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (worker) await closeTestWorker(worker);
  worker = undefined;
});

afterAll(async () => {
  await app.close();
});

/** A sent round of these seed employees; returns its id and its queued invitation rows. */
async function sentRound(numbers: string[] = ['1001', '1002']) {
  const templateId = await createTemplate(app, world.managerCookie, 'הצהרה', [world.dept[15]]);
  const round = await createDraft(
    app,
    world.managerCookie,
    templateId,
    numbers.map((n) => world.emp[n] ?? ''),
  );
  await sendRound(app, world.managerCookie, round.id);
  const invites = await prisma.emailMessage.findMany({
    where: { assignment: { roundId: round.id } },
    orderBy: { id: 'asc' },
  });
  return { roundId: round.id, invites };
}

type Invite = Awaited<ReturnType<typeof sentRound>>['invites'][number];

function jobOf(invite: Invite, attempt = 1, isLastAttempt = false): JobContext<InvitationJobData> {
  return {
    id: `job-${invite.id}`,
    data: { assignmentId: invite.assignmentId, emailMessageId: invite.id },
    attempt,
    isLastAttempt,
    signal: new AbortController().signal,
  };
}

/** An EmailService stand-in: records each call, answers with `answer` (default: accepted). */
function stubEmail(answer?: (call: number) => Promise<SendResult>) {
  const calls: InvitationEmailInput[] = [];
  const service = {
    sendInvitation: (input: InvitationEmailInput) => {
      calls.push(input);
      return answer
        ? answer(calls.length)
        : Promise.resolve({ providerMessageId: `<m${String(calls.length)}@test>` });
    },
  };
  const sender = new InvitationSender(
    prisma,
    repository,
    service as unknown as EmailService,
    app.get(AuditService),
  );
  return { calls, sender };
}

const reread = (id: string) => prisma.emailMessage.findUniqueOrThrow({ where: { id } });
const assignmentOf = (invite: Invite) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: invite.assignmentId } });
const roundStatus = async (id: string) =>
  (await prisma.round.findUniqueOrThrow({ where: { id } })).status;
const audits = (action: string) => prisma.auditLog.findMany({ where: { action } });

describe('InvitationSender: the happy path', () => {
  it('sends with a token whose hash is stored, settles the row and finishes the round', async () => {
    const { roundId, invites } = await sentRound();
    const { calls, sender } = stubEmail();
    const [first, second] = invites as [Invite, Invite];

    await sender.run(jobOf(first));
    expect(await roundStatus(roundId)).toBe('sending');
    await sender.run(jobOf(second));

    expect(calls).toHaveLength(2);
    for (const [index, invite] of [first, second].entries()) {
      const call = calls[index];
      const row = await reread(invite.id);
      expect(call?.to).toBe(invite.toEmail);
      expect(row.tokenHash).toBe(hashSigningToken(call?.token ?? ''));
      expect(row).toMatchObject({ status: 'sent', error: null });
      expect(row.providerMessageId).toBe(`<m${String(index + 1)}@test>`);
      expect(await assignmentOf(invite)).toMatchObject({ status: 'sent' });
      expect(call?.correction).toBe(false);
      expect(call?.expiresAt).toBeInstanceOf(Date);
    }
    expect(calls[0]?.token).not.toBe(calls[1]?.token);
    expect(await roundStatus(roundId)).toBe('active');
    expect(await audits('assignment.invite_sent')).toHaveLength(2);
    const [finished] = await audits('round.sending_finished');
    expect(finished?.details).toEqual({ sent: 2, failed: 0 });
    expect(await repository.inviteProgress(roundId)).toEqual({ queued: 0, sent: 2, failed: 0 });
  });

  it('a job run twice sends once and makes one token', async () => {
    const { invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { calls, sender } = stubEmail();
    await sender.run(jobOf(invite));
    const hash = (await reread(invite.id)).tokenHash;
    await sender.run(jobOf(invite, 2));
    expect(calls).toHaveLength(1);
    expect((await reread(invite.id)).tokenHash).toBe(hash);
    expect(await prisma.emailMessage.count()).toBe(1);
  });

  it('an assignment cancelled before its job → failed ASSIGNMENT_CLOSED, nothing sent', async () => {
    const { roundId, invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    await prisma.assignment.update({
      where: { id: invite.assignmentId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    const { calls, sender } = stubEmail();
    await sender.run(jobOf(invite));
    expect(calls).toHaveLength(0);
    expect(await reread(invite.id)).toMatchObject({
      status: 'failed',
      error: 'ASSIGNMENT_CLOSED',
      tokenHash: null,
    });
    expect(await roundStatus(roundId)).toBe('active');
  });
});

describe('InvitationSender: never one link twice', () => {
  it('a crash after the hand-over (hash stored, still queued) → sent UNCONFIRMED, not sent again', async () => {
    const { invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const hash = 'b'.repeat(64);
    await prisma.emailMessage.update({ where: { id: invite.id }, data: { tokenHash: hash } });
    const { calls, sender } = stubEmail();
    await sender.run(jobOf(invite, 2));
    expect(calls).toHaveLength(0);
    expect(await reread(invite.id)).toMatchObject({
      status: 'sent',
      error: 'UNCONFIRMED',
      tokenHash: hash,
      providerMessageId: null,
    });
    expect(await assignmentOf(invite)).toMatchObject({ status: 'sent' });
    const [audit] = await audits('assignment.invite_sent');
    expect(audit?.details).toMatchObject({ unconfirmed: true });
  });

  it('a temporary error that clearly never left: hash cleared, the retry sends with a new token', async () => {
    const { invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { calls, sender } = stubEmail((call) =>
      call === 1
        ? Promise.reject(new EmailSendError('temporary', 'ECONNECTION', 'not_sent'))
        : Promise.resolve({ providerMessageId: '<retry@test>' }),
    );

    await expect(sender.run(jobOf(invite, 1))).rejects.toThrow(EmailSendError);
    expect(await reread(invite.id)).toMatchObject({
      status: 'queued',
      tokenHash: null,
      error: 'ECONNECTION',
    });
    expect(await assignmentOf(invite)).toMatchObject({ status: 'pending' });

    await sender.run(jobOf(invite, 2));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.token).not.toBe(calls[0]?.token);
    const row = await reread(invite.id);
    expect(row).toMatchObject({ status: 'sent', error: null, providerMessageId: '<retry@test>' });
    expect(row.tokenHash).toBe(hashSigningToken(calls[1]?.token ?? ''));
    expect(row.tokenHash).not.toBe(hashSigningToken(calls[0]?.token ?? ''));
  });

  it('a temporary error that may have left (timeout during DATA) → UNCONFIRMED, same hash kept, no retry', async () => {
    const { invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { calls, sender } = stubEmail(() =>
      Promise.reject(new EmailSendError('temporary', 'ETIMEDOUT', 'maybe_sent')),
    );
    await sender.run(jobOf(invite, 1));
    expect(calls).toHaveLength(1);
    const row = await reread(invite.id);
    expect(row).toMatchObject({ status: 'sent', error: 'UNCONFIRMED:ETIMEDOUT' });
    expect(row.tokenHash).toBe(hashSigningToken(calls[0]?.token ?? ''));
    expect(await assignmentOf(invite)).toMatchObject({ status: 'sent' });
    const [audit] = await audits('assignment.invite_sent');
    expect(audit?.details).toMatchObject({ unconfirmed: true, providerCode: 'ETIMEDOUT' });

    await sender.run(jobOf(invite, 2));
    expect(calls).toHaveLength(1);
  });

  it('saving fails after the email went out: the retry finds the hash → UNCONFIRMED, no second email', async () => {
    const { invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { calls, sender } = stubEmail();
    vi.spyOn(repository, 'settleSent').mockRejectedValueOnce(new Error('connection lost'));

    await expect(sender.run(jobOf(invite, 1))).rejects.toThrow('connection lost');
    await sender.run(jobOf(invite, 2));
    expect(calls).toHaveLength(1);
    const row = await reread(invite.id);
    expect(row).toMatchObject({ status: 'sent', error: 'UNCONFIRMED' });
    expect(row.tokenHash).toBe(hashSigningToken(calls[0]?.token ?? ''));
  });
});

describe('InvitationSender: failures', () => {
  it('a permanent refusal → failed, the assignment invalid_email, no retry', async () => {
    const { roundId, invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { sender } = stubEmail(() =>
      Promise.reject(new EmailSendError('permanent', '550', 'not_sent')),
    );
    await sender.run(jobOf(invite));
    expect(await reread(invite.id)).toMatchObject({
      status: 'failed',
      error: '550',
      tokenHash: null,
    });
    expect(await assignmentOf(invite)).toMatchObject({ status: 'invalid_email' });
    const [audit] = await audits('assignment.invite_failed');
    expect(audit?.details).toMatchObject({ reason: 'permanent', providerCode: '550' });
    expect(await roundStatus(roundId)).toBe('active');
    expect(await repository.inviteProgress(roundId)).toEqual({ queued: 0, sent: 0, failed: 1 });
  });

  it('the last attempt of a temporary error → failed, the assignment stays pending', async () => {
    const { roundId, invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { sender } = stubEmail(() =>
      Promise.reject(new EmailSendError('temporary', '421', 'not_sent')),
    );
    await expect(sender.run(jobOf(invite, 6, true))).rejects.toThrow(EmailSendError);
    expect(await reread(invite.id)).toMatchObject({
      status: 'failed',
      error: '421',
      tokenHash: null,
    });
    expect(await assignmentOf(invite)).toMatchObject({ status: 'pending' });
    const [audit] = await audits('assignment.invite_failed');
    expect(audit?.details).toMatchObject({ reason: 'temporary_last_attempt', providerCode: '421' });
    expect(await roundStatus(roundId)).toBe('active');
  });

  it('an unexpected error before the provider: retried; on the last attempt failed, never sent', async () => {
    const { invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { calls, sender } = stubEmail(() => Promise.reject(new TypeError('render failed')));

    await expect(sender.run(jobOf(invite, 1))).rejects.toThrow(TypeError);
    expect(await reread(invite.id)).toMatchObject({
      status: 'queued',
      tokenHash: null,
      error: 'UNEXPECTED',
    });

    await expect(sender.run(jobOf(invite, 6, true))).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(2);
    expect(await reread(invite.id)).toMatchObject({
      status: 'failed',
      error: 'UNEXPECTED',
      tokenHash: null,
    });
    expect(await assignmentOf(invite)).toMatchObject({ status: 'pending' });
    const [audit] = await audits('assignment.invite_failed');
    expect(audit?.details).toMatchObject({ reason: 'unexpected_last_attempt' });
    expect(await audits('assignment.invite_sent')).toHaveLength(0);
  });

  it('an error before any token was stored, on the last attempt → failed, never sent', async () => {
    const { invites } = await sentRound(['1001']);
    const [invite] = invites as [Invite];
    const { calls, sender } = stubEmail();
    vi.spyOn(repository, 'setTokenHash').mockRejectedValueOnce(new Error('database busy'));
    await expect(sender.run(jobOf(invite, 6, true))).rejects.toThrow('database busy');
    expect(calls).toHaveLength(0);
    expect(await reread(invite.id)).toMatchObject({ status: 'failed', tokenHash: null });
    expect(await assignmentOf(invite)).toMatchObject({ status: 'pending' });
  });
});

describe('the worker, end to end (Mailpit)', () => {
  it('sends 50 invitations, each with its own working link; no token, email or ID in job data', async () => {
    const extra = 48;
    await prisma.employee.createMany({
      data: Array.from({ length: extra }, (_, i) => ({
        employeeNumber: String(30_000 + i),
        idNumber: String(600_000_000 + i),
        firstName: 'שרה',
        lastName: `לוי ${String(i)}`,
        departmentId: world.dept[15],
        email: freshEmail(`bulk${String(i)}`),
        emailStatus: 'valid' as const,
        address: `רחוב הנביאים ${String(i)}`,
        city: 'בני ברק',
      })),
    });
    const added = await prisma.employee.findMany({
      where: { employeeNumber: { startsWith: '300' } },
      select: { id: true },
    });
    const templateId = await createTemplate(app, world.managerCookie, 'חוזה', [world.dept[15]]);
    const round = await createDraft(app, world.managerCookie, templateId, [
      world.emp['1001'] ?? '',
      world.emp['1002'] ?? '',
      ...added.map(({ id }) => id),
    ]);
    const sent = await sendRound(app, world.managerCookie, round.id);
    expect(sent.counts.queued).toBe(50);

    worker = await createTestWorker();
    await waitFor(
      async () => ((await roundStatus(round.id)) === 'active' ? true : undefined),
      60_000,
    );

    const rows = await prisma.emailMessage.findMany({
      where: { assignment: { roundId: round.id } },
      include: { assignment: { include: { employee: true } } },
    });
    expect(rows).toHaveLength(50);
    const tokens = new Set<string>();
    for (const row of rows) {
      expect(row.status).toBe('sent');
      expect(row.assignment.status).toBe('sent');
      const [message] = await messagesTo(row.toEmail, 1);
      expect(message?.Subject).toBe('מסמך לחתימה: חוזה');
      const token = /\/sign\/([A-Za-z0-9_-]{43})/.exec(message?.Text ?? '')?.[1] ?? '';
      expect(hashSigningToken(token)).toBe(row.tokenHash);
      expect(message?.Text).not.toContain(row.assignment.employee.idNumber);
      tokens.add(token);
    }
    expect(tokens.size).toBe(50);

    const jobs = await prisma.$queryRawUnsafe<{ data: unknown }[]>(
      `SELECT data FROM "${QUEUE_SCHEMA}".job WHERE name = $1`,
      INVITATION_QUEUE.name,
    );
    const stored = JSON.stringify(jobs) + JSON.stringify(rows.map((r) => r.error));
    for (const token of tokens) expect(stored).not.toContain(token);
    for (const row of rows) {
      expect(JSON.stringify(jobs)).not.toContain(row.toEmail);
      expect(JSON.stringify(jobs)).not.toContain(row.assignment.employee.idNumber);
    }
    expect(await repository.inviteProgress(round.id)).toEqual({ queued: 0, sent: 50, failed: 0 });
  }, 90_000);

  it('a correction round invitation has the extra line and never the manager note', async () => {
    const note = 'יש לתקן את הכתובת בסעיף 4';
    const templateId = await createTemplate(app, world.managerCookie, 'הצהרה', [world.dept[15]]);
    const earlier = await prisma.round.create({
      data: {
        name: 'סבב מקורי',
        mode: 'single_template',
        status: 'active',
        linkExpiryDays: 60,
        createdById: world.managerId,
      },
    });
    const returned = await prisma.assignment.create({
      data: {
        roundId: earlier.id,
        employeeId: world.emp['1001'] ?? '',
        departmentId: world.dept[15],
        templateId,
        status: 'cancelled',
        cancelledAt: new Date(),
        returnedAt: new Date(),
        returnedById: world.managerId,
        returnNote: note,
      },
    });
    const round = await createDraft(app, world.managerCookie, templateId, [
      world.emp['1001'] ?? '',
    ]);
    await prisma.round.update({
      where: { id: round.id },
      data: { correctionOfAssignmentId: returned.id },
    });
    await sendRound(app, world.managerCookie, round.id);
    const [invite] = await prisma.emailMessage.findMany({
      where: { assignment: { roundId: round.id } },
    });
    if (!invite) throw new Error('no invitation');

    const sender = new InvitationSender(
      prisma,
      repository,
      app.get(EmailService),
      app.get(AuditService),
    );
    await sender.run(jobOf(invite));
    const [message] = await messagesTo(invite.toEmail, 1);
    expect(message?.Text).toContain('זהו מסמך מתוקן שממתין לחתימתך');
    expect(message?.HTML).toContain('זהו מסמך מתוקן שממתין לחתימתך');
    expect(message?.Text).not.toContain(note);
    expect(message?.HTML).not.toContain(note);
  });
});
