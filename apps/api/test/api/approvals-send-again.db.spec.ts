import { randomUUID } from 'node:crypto';
import { ROUND_NAME_MAX_LENGTH, sentAgainSchema } from '@doc-signing/shared';
import type { INestApplicationContext, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashSigningToken } from '../../src/common/email/signing-token.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { SettingsService } from '../../src/common/settings/settings.service.js';
import { correctionRoundName } from '../../src/modules/approvals/approvals.rules.js';
import { getAs, personOf, postApproval, returnRow, waitingRound } from '../setup/approvals.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { messagesTo } from '../setup/mailpit.js';
import { errorOf } from '../setup/round-actions.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { signServer, type SigningRound, verifiedCookie } from '../setup/signing.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

/**
 * "Send again" after a return (3.16 part B2, FR-TRK-6): one linked one-employee correction round,
 * created and sent in one transaction; a second call or two at once → one round, one email.
 */

const CORRECTION_LINE = 'זהו מסמך מתוקן שממתין לחתימתך';

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;
let worker: INestApplicationContext | undefined;

const idOf = (number: string) => personOf(round, number).assignmentId;
const roundCount = () => prisma.round.count();

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  round = await waitingRound(app, prisma, world, ['1001', '1002']);
});

afterEach(async () => {
  if (worker) await closeTestWorker(worker);
  worker = undefined;
});

afterAll(async () => {
  await app.close();
});

async function sendAgain(number: string) {
  const response = await postApproval(app, idOf(number), 'send-again', world.managerCookie);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return sentAgainSchema.parse(response.body);
}

describe('POST /api/assignments/:id/send-again', () => {
  it('creates and sends one linked correction round with the default settings', async () => {
    await returnRow(app, world, idOf('1001'));
    const sent = await sendAgain('1001');
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    const name = `תיקון: סבב ניסיון – ${employee.firstName} ${employee.lastName}`;
    expect(sent).toMatchObject({
      name,
      status: 'sending',
      template: { id: round.templateId, name: 'הצהרת עובדת', version: 1 },
      assignment: { status: 'pending' },
    });

    const created = await prisma.round.findUniqueOrThrow({
      where: { id: sent.roundId },
      include: { templates: true, assignments: true },
    });
    const defaults = await app.get(SettingsService).getRoundDefaults();
    expect(created).toMatchObject({
      name,
      mode: 'single_template',
      status: 'sending',
      correctionOfAssignmentId: idOf('1001'),
      remindersEnabled: true,
      reminderIntervalDays: defaults.reminderIntervalDays,
      maxReminders: defaults.maxReminders,
      linkExpiryDays: defaults.linkExpiryDays,
    });
    expect(created.sentAt?.toISOString()).toBe(sent.sentAt);
    expect(created.templates).toEqual([
      expect.objectContaining({ departmentId: null, templateId: round.templateId }),
    ]);
    expect(created.assignments).toHaveLength(1);
    const [row] = created.assignments;
    expect(row).toMatchObject({ id: sent.assignment.id, employeeId: world.emp['1001'] });
    expect(row?.fieldValues).not.toBeNull();

    const invites = await prisma.emailMessage.findMany({ where: { assignmentId: row?.id } });
    expect(invites).toEqual([
      expect.objectContaining({ type: 'invite', status: 'queued', toEmail: employee.email }),
    ]);
    // The original row stays returned, its file untouched.
    expect(
      await prisma.assignment.findUniqueOrThrow({ where: { id: idOf('1001') } }),
    ).toMatchObject({ status: 'cancelled', signMethod: 'digital' });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.sent_again' },
    });
    expect(audit).toMatchObject({ userId: world.managerId, entityId: idOf('1001') });
    expect(audit.details).toEqual({
      roundId: round.roundId,
      correctionRoundId: sent.roundId,
      templateId: round.templateId,
      status: 'pending',
    });
    for (const action of ['round.created', 'round.sent']) {
      expect(
        await prisma.auditLog.count({ where: { action, entityId: sent.roundId } }),
        action,
      ).toBe(1);
    }

    // The 3.11 links both ways.
    const table = await getAs(
      app,
      `/api/rounds/${round.roundId}/assignments?returned=true`,
      world.managerCookie,
    );
    const [returned] = (table.body as { items: { returned: unknown }[] }).items;
    expect(returned?.returned).toMatchObject({ correctionRound: { id: sent.roundId, name } });
    const details = await getAs(app, `/api/rounds/${sent.roundId}`, world.managerCookie);
    expect((details.body as { correctionOf: unknown }).correctionOf).toEqual({
      roundId: round.roundId,
      roundName: 'סבב ניסיון',
      assignmentId: idOf('1001'),
    });
  });

  it('takes the newest version of the same template', async () => {
    await returnRow(app, world, idOf('1001'));
    const renamed = await request(httpServer(app))
      .patch(`/api/templates/${round.templateId}`)
      .set('Cookie', world.managerCookie)
      .send({ name: 'הצהרת עובדת מעודכנת' });
    expect(renamed.status).toBe(200);
    const newest = (renamed.body as { id: string }).id;
    expect(newest).not.toBe(round.templateId);

    const sent = await sendAgain('1001');
    expect(sent.template).toEqual({ id: newest, name: 'הצהרת עובדת מעודכנת', version: 2 });
    const row = await prisma.assignment.findUniqueOrThrow({ where: { id: sent.assignment.id } });
    expect(row.templateId).toBe(newest);
  });

  it('a long round name is cut at 150 characters', async () => {
    await prisma.round.update({
      where: { id: round.roundId },
      data: { name: 'ש'.repeat(ROUND_NAME_MAX_LENGTH) },
    });
    await returnRow(app, world, idOf('1001'));
    const sent = await sendAgain('1001');
    expect(Array.from(sent.name)).toHaveLength(ROUND_NAME_MAX_LENGTH);
    expect(sent.name.startsWith('תיקון: ששש')).toBe(true);
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    expect(sent.name).toBe(
      correctionRoundName('ש'.repeat(ROUND_NAME_MAX_LENGTH), employee.firstName, employee.lastName),
    );
  });

  it('the real worker: the invitation has the correction line, never the note; the form has the note', async () => {
    const note = 'נא לכתוב שם פרטי ושם משפחה מלאים';
    const email = freshEmail('correction');
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { email, emailStatus: 'valid' },
    });
    await returnRow(app, world, idOf('1001'), note);
    const sent = await sendAgain('1001');

    worker = await createTestWorker();
    await waitFor(async () => {
      const invite = await prisma.emailMessage.findFirst({
        where: { assignmentId: sent.assignment.id, status: 'sent' },
      });
      return invite ?? undefined;
    }, 30_000);
    const [message] = await messagesTo(email, 1);
    expect(message?.Text).toContain(CORRECTION_LINE);
    expect(message?.HTML).toContain(CORRECTION_LINE);
    expect(message?.Text).not.toContain(note);
    expect(message?.HTML).not.toContain(note);

    const token = /\/sign\/([A-Za-z0-9_-]{43})/.exec(message?.Text ?? '')?.[1] ?? '';
    const invite = await prisma.emailMessage.findFirstOrThrow({
      where: { assignmentId: sent.assignment.id },
    });
    expect(hashSigningToken(token)).toBe(invite.tokenHash);
    const state = await signServer(app).get(`/api/sign/${token}`);
    expect(JSON.stringify(state.body)).not.toContain(note);
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    const cookie = await verifiedCookie(app, {
      ...personOf(round, '1001'),
      assignmentId: sent.assignment.id,
      emailMessageId: invite.id,
      token,
      idNumber: employee.idNumber,
      email,
    });
    const form = await signServer(app).get(`/api/sign/${token}/form`).set('Cookie', cookie);
    expect(form.status).toBe(200);
    expect((form.body as { correctionNote: string | null }).correctionNote).toBe(note);
  }, 60_000);

  it('no email now → no_email, nothing queued; missing details → missing_data', async () => {
    await returnRow(app, world, idOf('1001'));
    await returnRow(app, world, idOf('1002'));
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { email: null, emailStatus: 'missing' },
    });
    await prisma.employee.update({
      where: { id: world.emp['1002'] },
      data: { address: null, city: null },
    });
    const noEmail = await sendAgain('1001');
    expect(noEmail).toMatchObject({ status: 'active', assignment: { status: 'no_email' } });
    const missing = await sendAgain('1002');
    expect(missing).toMatchObject({ status: 'active', assignment: { status: 'missing_data' } });
    const ids = [noEmail.assignment.id, missing.assignment.id];
    expect(await prisma.emailMessage.count({ where: { assignmentId: { in: ids } } })).toBe(0);
  });

  it('a second call → 409 with the existing round', async () => {
    await returnRow(app, world, idOf('1001'));
    const sent = await sendAgain('1001');
    const again = await postApproval(app, idOf('1001'), 'send-again', world.managerCookie);
    expect(again.status).toBe(409);
    expect(errorOf(again)).toMatchObject({
      code: 'CORRECTION_ROUND_EXISTS',
      details: { roundId: sent.roundId },
    });
    expect(await prisma.round.count({ where: { correctionOfAssignmentId: idOf('1001') } })).toBe(1);
  });

  it('two calls at once (×5) → one round and one email', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      world = await seedRoundsWorld(app, prisma);
      await clearQueueJobs(prisma);
      round = await waitingRound(app, prisma, world, ['1001']);
      await returnRow(app, world, idOf('1001'));
      const answers = await Promise.all([
        postApproval(app, idOf('1001'), 'send-again', world.managerCookie),
        postApproval(app, idOf('1001'), 'send-again', world.managerCookie),
      ]);
      const codes = answers.map(({ status }) => status).sort();
      expect(codes, JSON.stringify(answers.map(({ body }) => body as unknown))).toEqual([201, 409]);
      const conflict = answers.find(({ status }) => status === 409);
      const created = answers.find(({ status }) => status === 201);
      expect(errorOf(conflict as request.Response).details).toEqual({
        roundId: sentAgainSchema.parse(created?.body).roundId,
      });
      const corrections = await prisma.round.findMany({
        where: { correctionOfAssignmentId: idOf('1001') },
        include: { assignments: { include: { emails: true } } },
      });
      expect(corrections).toHaveLength(1);
      expect(corrections[0]?.assignments.flatMap(({ emails }) => emails)).toHaveLength(1);
    }
  }, 120_000);

  it('409 when not returned; nothing is written', async () => {
    const rounds = await roundCount();
    const waiting = await postApproval(app, idOf('1001'), 'send-again', world.managerCookie);
    expect(waiting.status).toBe(409);
    expect(errorOf(waiting)).toMatchObject({
      code: 'ASSIGNMENT_NOT_RETURNED',
      details: { status: 'signed' },
    });
    await prisma.assignment.update({
      where: { id: idOf('1002') },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    const cancelled = await postApproval(app, idOf('1002'), 'send-again', world.managerCookie);
    expect(errorOf(cancelled).code).toBe('ASSIGNMENT_NOT_RETURNED');
    expect(await roundCount()).toBe(rounds);
  });

  it('an inactive employee → 409 EMPLOYEE_INACTIVE; the row stays returned and can go later', async () => {
    await returnRow(app, world, idOf('1001'));
    await prisma.employee.update({ where: { id: world.emp['1001'] }, data: { isActive: false } });
    const rounds = await roundCount();
    const refused = await postApproval(app, idOf('1001'), 'send-again', world.managerCookie);
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('EMPLOYEE_INACTIVE');
    expect(await roundCount()).toBe(rounds);

    await prisma.employee.update({ where: { id: world.emp['1001'] }, data: { isActive: true } });
    expect((await sendAgain('1001')).assignment.status).toBe('pending');
  });

  it('the template archived → 409 ROUND_CANNOT_BE_CREATED; nothing is written', async () => {
    await returnRow(app, world, idOf('1001'));
    const archived = await request(httpServer(app))
      .post(`/api/templates/${round.templateId}/archive`)
      .set('Cookie', world.managerCookie);
    expect(archived.status).toBe(200);
    const rounds = await roundCount();
    const refused = await postApproval(app, idOf('1001'), 'send-again', world.managerCookie);
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('ROUND_CANNOT_BE_CREATED');
    const blockers = (errorOf(refused).details?.blockers ?? []) as { code: string }[];
    expect(blockers.map(({ code }) => code)).toContain('TEMPLATE_NOT_ACTIVE');
    expect(await roundCount()).toBe(rounds);
    // Only the original round's own two rows.
    expect(
      await prisma.auditLog.count({ where: { action: { in: ['round.created', 'round.sent'] } } }),
    ).toBe(2);
  });

  it('officer 403, signed out 401, unknown 404', async () => {
    await returnRow(app, world, idOf('1001'));
    expect((await postApproval(app, idOf('1001'), 'send-again', world.officerCookie)).status).toBe(
      403,
    );
    expect((await postApproval(app, idOf('1001'), 'send-again', null)).status).toBe(401);
    expect((await postApproval(app, randomUUID(), 'send-again', world.managerCookie)).status).toBe(
      404,
    );
    expect(await prisma.round.count({ where: { correctionOfAssignmentId: idOf('1001') } })).toBe(0);
  });
});
