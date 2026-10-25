import type { ApiError } from '@doc-signing/shared';
import { type INestApplication, Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { WEBHOOK_RATE_SCOPE } from '../../src/modules/webhooks/webhook-rate-limit.service.js';
import { createTestApp } from '../setup/app.js';
import { dailyReminders, inDays } from '../setup/daily-reminders.js';
import { postAction, sentRoundOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { addReminderLink, signAs, type SigningRound, signingRound } from '../setup/signing.js';
import { setState } from '../setup/tracking.js';
import { postBounce, postNotice, TEST_WEBHOOK_SECRET, withProviderId } from '../setup/webhooks.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * The bounce webhook (3.15): POST /api/webhooks/email with the test provider. A round of three
 * employees, every invitation sent two days ago (`signingRound`). Made-up employees only.
 */

const NUMBERS = ['1001', '1002', '1003'];

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, NUMBERS);
});

afterAll(async () => {
  await app.close();
});

const person = (number: string) => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};
const assignmentOf = (number: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: person(number).assignmentId } });
const employeeOf = (number: string) =>
  prisma.employee.findUniqueOrThrow({ where: { id: person(number).employeeId } });
const emailRow = (id: string) => prisma.emailMessage.findUniqueOrThrow({ where: { id } });
const bounceAudits = () =>
  prisma.auditLog.findMany({
    where: { action: { in: ['email.bounced', 'email.soft_bounced'] } },
    orderBy: { id: 'asc' },
  });
const errorOf = (body: unknown) => (body as ApiError).error;

/** Everything a bounce could change, to prove nothing did. */
async function snapshot() {
  return {
    assignments: await prisma.assignment.findMany({
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    }),
    emails: await prisma.emailMessage.findMany({
      select: { id: true, status: true, error: true },
      orderBy: { id: 'asc' },
    }),
    employees: await prisma.employee.findMany({
      select: { id: true, emailStatus: true },
      orderBy: { id: 'asc' },
    }),
    audits: await bounceAudits(),
  };
}

describe('a hard bounce', () => {
  it('marks the email bounced, the employee bounced and her row invalid_email', async () => {
    const dana = person('1001');
    const messageId = await withProviderId(prisma, dana.emailMessageId);

    const response = await postBounce(app, messageId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({ received: 1 });

    expect(await emailRow(dana.emailMessageId)).toMatchObject({
      status: 'bounced',
      error: 'BOUNCED',
    });
    expect((await employeeOf('1001')).emailStatus).toBe('bounced');
    expect((await assignmentOf('1001')).status).toBe('invalid_email');
    // The others are untouched.
    expect((await assignmentOf('1002')).status).toBe('sent');
    expect((await employeeOf('1002')).emailStatus).toBe('valid');

    const audits = await bounceAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: 'system',
      userId: null,
      action: 'email.bounced',
      entityType: 'assignment',
      entityId: dana.assignmentId,
      ip: null,
      details: {
        roundId: round.roundId,
        emailMessageId: dana.emailMessageId,
        emailType: 'invite',
        employeeMarkedBounced: true,
        invalidatedAssignmentIds: [dana.assignmentId],
      },
    });
  });

  it('writes ids only: no address, name or provider id in the audit row', async () => {
    const dana = person('1001');
    const messageId = await withProviderId(prisma, dana.emailMessageId);
    await postBounce(app, messageId);
    const employee = await employeeOf('1001');
    const text = JSON.stringify((await bounceAudits()).map((row) => row.details));
    for (const secret of [dana.email, employee.firstName, employee.lastName, messageId]) {
      expect(text).not.toContain(secret);
    }
  });

  it('a reminder that bounces does the same', async () => {
    const reminder = await addReminderLink(prisma, person('1002'), person('1002').email);
    await postBounce(app, await withProviderId(prisma, reminder.emailMessageId));
    expect((await emailRow(reminder.emailMessageId)).status).toBe('bounced');
    expect((await emailRow(person('1002').emailMessageId)).status).toBe('sent');
    expect((await assignmentOf('1002')).status).toBe('invalid_email');
    expect((await bounceAudits())[0]?.details).toMatchObject({ emailType: 'reminder' });
  });

  it('also marks her open row in another round whose newest link went to that address', async () => {
    const other = await sentRoundOf(app, prisma, world, ['1001']);
    const otherId = other.assignment['1001'] ?? '';
    await postBounce(app, await withProviderId(prisma, person('1001').emailMessageId));
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: otherId } })).status).toBe(
      'invalid_email',
    );
    const details = (await bounceAudits())[0]?.details as { invalidatedAssignmentIds: string[] };
    expect(details.invalidatedAssignmentIds).toEqual([person('1001').assignmentId, otherId].sort());
  });

  it('several events in one notice', async () => {
    const ids = await Promise.all(
      ['1001', '1002'].map((n) => withProviderId(prisma, person(n).emailMessageId)),
    );
    const response = await postNotice(app, {
      events: [
        ...ids.map((messageId) => ({ type: 'bounce', bounceType: 'hard', messageId })),
        { type: 'delivery', messageId: ids[0] },
      ],
    });
    expect(response.body).toEqual({ received: 3 });
    expect((await assignmentOf('1001')).status).toBe('invalid_email');
    expect((await assignmentOf('1002')).status).toBe('invalid_email');
    expect((await assignmentOf('1003')).status).toBe('sent');
  });
});

describe('repeated, unknown and ignored notices', () => {
  it('the same bounce twice changes nothing the second time', async () => {
    const messageId = await withProviderId(prisma, person('1001').emailMessageId);
    expect((await postBounce(app, messageId)).status).toBe(200);
    const before = await snapshot();
    const again = await postBounce(app, messageId);
    expect(again.status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it('an unknown message id: 200, nothing changed, one log line', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const before = await snapshot();
      const response = await postBounce(app, '<unknown@nowhere.test>');
      expect(response.status).toBe(200);
      expect(await snapshot()).toEqual(before);
      expect(warn).toHaveBeenCalledWith(
        'Bounce for an unknown message ignored (<unknown@nowhere.test>)',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('delivery and complaint notices change nothing', async () => {
    const messageId = await withProviderId(prisma, person('1001').emailMessageId);
    const before = await snapshot();
    const response = await postNotice(app, {
      events: [
        { type: 'delivery', messageId },
        { type: 'complaint', messageId },
      ],
    });
    expect(response.status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});

describe('a soft bounce', () => {
  it('changes no status and is logged once per email', async () => {
    const dana = person('1001');
    const messageId = await withProviderId(prisma, dana.emailMessageId);
    const before = await snapshot();
    expect((await postBounce(app, messageId, 'soft')).status).toBe(200);
    expect((await postBounce(app, messageId, 'soft')).status).toBe(200);
    const after = await snapshot();
    expect({ ...after, audits: [] }).toEqual({ ...before, audits: [] });
    expect(after.audits).toHaveLength(1);
    expect(after.audits[0]).toMatchObject({
      action: 'email.soft_bounced',
      entityId: dana.assignmentId,
      details: { roundId: round.roundId, emailMessageId: dana.emailMessageId, emailType: 'invite' },
    });
  });

  it('then a hard bounce still counts; a soft one after it adds nothing', async () => {
    const messageId = await withProviderId(prisma, person('1001').emailMessageId);
    await postBounce(app, messageId, 'soft');
    await postBounce(app, messageId, 'hard');
    expect((await assignmentOf('1001')).status).toBe('invalid_email');
    await postBounce(app, messageId, 'soft');
    expect((await bounceAudits()).map((row) => row.action)).toEqual([
      'email.soft_bounced',
      'email.bounced',
    ]);
  });
});

describe('what a bounce never changes', () => {
  it('a signed row: an invitation bounce marks only the email (and the dead address)', async () => {
    const dana = person('1001');
    expect((await signAs(app, dana)).status).toBe(201);
    await postBounce(app, await withProviderId(prisma, dana.emailMessageId));
    expect((await assignmentOf('1001')).status).toBe('signed');
    expect((await emailRow(dana.emailMessageId)).status).toBe('bounced');
    expect((await bounceAudits())[0]?.details).toMatchObject({ invalidatedAssignmentIds: [] });
  });

  it('a bounced signed copy marks only its row; the assignment stays signed', async () => {
    const dana = person('1001');
    expect((await signAs(app, dana)).status).toBe(201);
    const copy = await prisma.emailMessage.findFirstOrThrow({
      where: { assignmentId: dana.assignmentId, type: 'signed_copy' },
    });
    await prisma.emailMessage.update({
      where: { id: copy.id },
      data: { status: 'sent', sentAt: new Date() },
    });
    await postBounce(app, await withProviderId(prisma, copy.id));
    expect((await emailRow(copy.id)).status).toBe('bounced');
    expect((await assignmentOf('1001')).status).toBe('signed');
    expect((await bounceAudits())[0]?.details).toMatchObject({
      emailType: 'signed_copy',
      invalidatedAssignmentIds: [],
    });
  });

  it('signed_manual and cancelled rows stay', async () => {
    await setState(prisma, person('1001').assignmentId, world.managerId, {
      status: 'signed_manual',
    });
    await setState(prisma, person('1002').assignmentId, world.managerId, { status: 'cancelled' });
    for (const n of ['1001', '1002']) {
      await postBounce(app, await withProviderId(prisma, person(n).emailMessageId));
    }
    expect((await assignmentOf('1001')).status).toBe('signed_manual');
    expect((await assignmentOf('1002')).status).toBe('cancelled');
  });
});

describe('a late bounce after the address was fixed', () => {
  const NEW_ADDRESS = 'dana.fixed@example.com';

  it('address changed, no new email yet: the row is marked, the new address is not', async () => {
    await prisma.employee.update({
      where: { id: person('1001').employeeId },
      data: { email: NEW_ADDRESS, emailStatus: 'valid' },
    });
    await postBounce(app, await withProviderId(prisma, person('1001').emailMessageId));
    expect((await assignmentOf('1001')).status).toBe('invalid_email');
    expect((await employeeOf('1001')).emailStatus).toBe('valid');
    expect((await bounceAudits())[0]?.details).toMatchObject({ employeeMarkedBounced: false });
  });

  it('a new invitation already went to the new address: only the email row is bounced', async () => {
    await prisma.employee.update({
      where: { id: person('1001').employeeId },
      data: { email: NEW_ADDRESS, emailStatus: 'valid' },
    });
    await addReminderLink(prisma, person('1001'), NEW_ADDRESS);
    await postBounce(app, await withProviderId(prisma, person('1001').emailMessageId));
    expect((await emailRow(person('1001').emailMessageId)).status).toBe('bounced');
    expect((await assignmentOf('1001')).status).toBe('sent');
    expect((await employeeOf('1001')).emailStatus).toBe('valid');
    expect((await bounceAudits())[0]?.details).toMatchObject({
      employeeMarkedBounced: false,
      invalidatedAssignmentIds: [],
    });
  });
});

describe('after a bounce', () => {
  it('the daily reminders skip her', async () => {
    await postBounce(app, await withProviderId(prisma, person('1001').emailMessageId));
    const daily = dailyReminders(app, prisma);
    const result = await daily.service.run({ now: inDays(1) });
    expect(result.queued).toBe(NUMBERS.length - 1);
    const reminded = await prisma.emailMessage.findMany({
      where: { type: 'reminder' },
      select: { assignmentId: true },
    });
    expect(reminded.map((row) => row.assignmentId)).not.toContain(person('1001').assignmentId);
  });

  it('a reminder already queued to the dead address is never sent', async () => {
    const daily = dailyReminders(app, prisma);
    await daily.service.run({ now: inDays(1) });
    const queued = await prisma.emailMessage.findFirstOrThrow({
      where: { type: 'reminder', assignmentId: person('1001').assignmentId },
    });
    await postBounce(app, await withProviderId(prisma, person('1001').emailMessageId));
    expect((await assignmentOf('1001')).status).toBe('invalid_email');
    await daily.sendQueued();
    expect(await emailRow(queued.id)).toMatchObject({
      status: 'failed',
      error: 'ASSIGNMENT_CLOSED',
    });
    expect(daily.calls.map((call) => call.to)).not.toContain(person('1001').email);
  });

  it('resend needs a new address', async () => {
    await postBounce(app, await withProviderId(prisma, person('1001').emailMessageId));
    const path = `/api/assignments/${person('1001').assignmentId}/resend`;
    const refused = await postAction(app, path, world.managerCookie);
    expect(refused.status).toBe(409);
    await prisma.employee.update({
      where: { id: person('1001').employeeId },
      data: { email: 'dana.fixed@example.com', emailStatus: 'valid' },
    });
    expect((await postAction(app, path, world.managerCookie)).status).toBe(202);
  });

  it('she can still open the link she has and sign', async () => {
    await postBounce(app, await withProviderId(prisma, person('1001').emailMessageId));
    expect((await assignmentOf('1001')).status).toBe('invalid_email');
    const response = await signAs(app, person('1001'));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await assignmentOf('1001')).status).toBe('signed');
  });
});

describe('the signature check', () => {
  it('wrong secret, no headers, too old: 401 with no details, nothing changed', async () => {
    const messageId = await withProviderId(prisma, person('1001').emailMessageId);
    const before = await snapshot();
    const refused = [
      await postBounce(app, messageId, 'hard', { secret: `${TEST_WEBHOOK_SECRET}-wrong` }),
      await postBounce(app, messageId, 'hard', { headers: {} }),
      await postBounce(app, messageId, 'hard', { signedAt: new Date(Date.now() - 6 * 60_000) }),
      await postBounce(app, messageId, 'hard', { signedAt: new Date(Date.now() + 6 * 60_000) }),
    ];
    for (const response of refused) {
      expect(response.status).toBe(401);
      expect(errorOf(response.body).code).toBe('WEBHOOK_UNAUTHORIZED');
      expect(errorOf(response.body).details).toBeUndefined();
    }
    expect(await snapshot()).toEqual(before);
  });

  it('a staff cookie gives nothing without the signature', async () => {
    const messageId = await withProviderId(prisma, person('1001').emailMessageId);
    const response = await postBounce(app, messageId, 'hard', {
      headers: { cookie: world.managerCookie },
    });
    expect(response.status).toBe(401);
  });

  it('a signed body of the wrong shape: 400', async () => {
    const response = await postNotice(app, { events: [{ type: 'bounce', messageId: '<a@b>' }] });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('a body over 256 KB: 413', async () => {
    const response = await postNotice(app, 'x'.repeat(257 * 1024));
    expect(response.status).toBe(413);
  });
});

describe('the per-IP limit', () => {
  it('429 with Retry-After once the IP is over the limit, signed or not', async () => {
    // One request makes this IP's counter; then it is put at the limit (3,000).
    expect((await postBounce(app, '<a@b>')).status).toBe(200);
    await prisma.signingRateHit.updateMany({
      where: { scope: WEBHOOK_RATE_SCOPE },
      data: { hits: 3000 },
    });
    const messageId = await withProviderId(prisma, person('1001').emailMessageId);
    const response = await postBounce(app, messageId);
    expect(response.status).toBe(429);
    expect(errorOf(response.body).code).toBe('TOO_MANY_REQUESTS');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect((await assignmentOf('1001')).status).toBe('sent');
  });

  it('counts every request, unsigned ones too', async () => {
    await postBounce(app, '<a@b>', 'hard', { headers: {} });
    await postBounce(app, '<a@b>');
    const rows = await prisma.signingRateHit.findMany({ where: { scope: WEBHOOK_RATE_SCOPE } });
    expect(rows.reduce((sum, row) => sum + row.hits, 0)).toBe(2);
  });
});

describe('with no provider set up', () => {
  it('refuses every notice', async () => {
    const saved = process.env.EMAIL_WEBHOOK_PROVIDER;
    process.env.EMAIL_WEBHOOK_PROVIDER = '';
    const disabled = await createTestApp();
    try {
      const messageId = await withProviderId(prisma, person('1001').emailMessageId);
      const response = await postBounce(disabled, messageId);
      expect(response.status).toBe(401);
      expect((await assignmentOf('1001')).status).toBe('sent');
    } finally {
      process.env.EMAIL_WEBHOOK_PROVIDER = saved;
      await disabled.close();
    }
  });
});
