import { manualSentSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { INVITATION_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { createTestApp } from '../setup/app.js';
import { messagesTo } from '../setup/mailpit.js';
import { manualRound, postManual } from '../setup/manual-handling.js';
import { errorOf, jobsOf, type SentRound } from '../setup/round-actions.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

/** The manual-handling send (3.16 part A, FR-MAN-1, FR-EMP-6). Made-up employees only. */

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
  round = await manualRound(app, prisma, world);
  await clearQueueJobs(prisma);
});

afterAll(async () => {
  await app.close();
});

const idOf = (number: string) => round.assignment[number] ?? '';
const send = (numbers: string[], cookie: string | null = world.managerCookie) =>
  postManual(app, 'send', { assignmentIds: numbers.map(idOf) }, cookie);
const rowOf = (number: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: idOf(number) } });
const invitesOf = (number: string) =>
  prisma.emailMessage.findMany({
    where: { assignmentId: idOf(number), type: 'invite' },
    orderBy: { createdAt: 'asc' },
  });

async function addEmail(number: string): Promise<string> {
  const email = freshEmail(`m${number}`);
  await prisma.employee.update({
    where: { id: world.emp[number] },
    data: { email, emailStatus: 'valid' },
  });
  return email;
}

describe('POST /api/manual-handling/send', () => {
  it('email added: no_email → pending, one queued invitation to the new address, values kept', async () => {
    const before = await rowOf('1001');
    const email = await addEmail('1001');
    const response = await send(['1001']);
    expect(response.status, JSON.stringify(response.body)).toBe(202);
    const [item] = manualSentSchema.parse(response.body).items;
    expect(item).toMatchObject({ assignmentId: idOf('1001'), roundId: round.roundId });
    expect(item?.status).toBe('pending');
    const after = await rowOf('1001');
    expect(after.status).toBe('pending');
    expect(after.fieldValues).toEqual(before.fieldValues);
    const invites = await invitesOf('1001');
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      id: item?.emailMessageId,
      toEmail: email,
      status: 'queued',
    });
    expect(invites[0]?.tokenHash).toBeNull();
    const jobs = await jobsOf(prisma, INVITATION_QUEUE.name);
    expect(jobs).toEqual([
      {
        data: { assignmentId: idOf('1001'), emailMessageId: item?.emailMessageId },
        singletonKey: idOf('1001'),
      },
    ]);
  });

  it('the real worker sends it: status sent, a new token, one email in Mailpit', async () => {
    const email = await addEmail('1001');
    expect((await send(['1001'])).status).toBe(202);
    const worker = await createTestWorker();
    try {
      await waitFor(async () => ((await rowOf('1001')).status === 'sent' ? true : undefined));
    } finally {
      await closeTestWorker(worker);
    }
    const [invite] = await invitesOf('1001');
    expect(invite?.status).toBe('sent');
    expect(invite?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const messages = await messagesTo(email, 1);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.Text).toContain('/sign/');
  }, 30_000);

  it('email fixed: invalid_email → pending; the same bounced address → 409', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1004'] },
      data: { emailStatus: 'valid' },
    });
    const same = await send(['1004']);
    expect(same.status).toBe(409);
    expect(errorOf(same).code).toBe('EMAIL_NOT_CHANGED');
    const email = await addEmail('1004');
    expect((await send(['1004'])).status).toBe(202);
    expect((await rowOf('1004')).status).toBe('pending');
    expect((await invitesOf('1004')).at(-1)?.toEmail).toBe(email);
  });

  it('details completed: values saved now and an invitation', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1002'] },
      data: { address: 'הנביאים 5', city: 'בני ברק' },
    });
    expect((await rowOf('1002')).fieldValues).toBeNull();
    expect((await send(['1002'])).status).toBe(202);
    const row = await rowOf('1002');
    expect(row.status).toBe('pending');
    expect(JSON.stringify(row.fieldValues)).toContain('הנביאים 5, בני ברק');
    expect(await invitesOf('1002')).toHaveLength(1);
  });

  it('details completed without a valid email: no_email with the values saved (printable), no email', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1002'] },
      data: { address: 'הנביאים 5', city: 'בני ברק', email: null, emailStatus: 'missing' },
    });
    const response = await send(['1002']);
    expect(response.status).toBe(202);
    expect(manualSentSchema.parse(response.body).items[0]).toMatchObject({
      status: 'no_email',
      emailMessageId: null,
    });
    const row = await rowOf('1002');
    expect(row.status).toBe('no_email');
    expect(row.fieldValues).not.toBeNull();
    expect(await invitesOf('1002')).toHaveLength(0);
  });

  it('still missing → 409 with the missing names only; no_email still without email → 409', async () => {
    const missing = await send(['1002']);
    expect(missing.status).toBe(409);
    expect(errorOf(missing)).toMatchObject({
      code: 'MISSING_DATA_STILL_MISSING',
      details: {
        refused: [
          { assignmentId: idOf('1002'), code: 'MISSING_DATA_STILL_MISSING', missing: ['כתובת'] },
        ],
      },
    });
    const noEmail = await send(['1001']);
    expect(noEmail.status).toBe(409);
    expect(errorOf(noEmail).code).toBe('EMPLOYEE_NO_VALID_EMAIL');
    expect((await rowOf('1002')).status).toBe('missing_data');
    expect((await rowOf('1001')).status).toBe('no_email');
  });

  it('a signed row, a sent row, a cancelled row → 409', async () => {
    const sent = await send(['1003']);
    expect(sent.status).toBe(409);
    expect(errorOf(sent).code).toBe('ASSIGNMENT_NOT_IN_MANUAL_HANDLING');
    await setState(prisma, idOf('1003'), world.managerId, { status: 'signed' });
    expect(errorOf(await send(['1003'])).code).toBe('ASSIGNMENT_ALREADY_SIGNED');
    await setState(prisma, idOf('1003'), world.managerId, { status: 'cancelled' });
    expect(errorOf(await send(['1003'])).code).toBe('ASSIGNMENT_ALREADY_CANCELLED');
  });

  it('all or nothing: one refused row sends none of them', async () => {
    await addEmail('1001');
    const response = await send(['1001', '1002']);
    expect(response.status).toBe(409);
    expect(errorOf(response).details).toEqual({
      refused: [
        { assignmentId: idOf('1002'), code: 'MISSING_DATA_STILL_MISSING', missing: ['כתובת'] },
      ],
    });
    expect((await rowOf('1001')).status).toBe('no_email');
    expect(await invitesOf('1001')).toHaveLength(0);
    expect(await jobsOf(prisma, INVITATION_QUEUE.name)).toEqual([]);
  });

  it('several ready rows at once', async () => {
    await addEmail('1001');
    await addEmail('1004');
    const response = await send(['1004', '1001']);
    expect(response.status).toBe(202);
    expect(manualSentSchema.parse(response.body).items.map((item) => item.status)).toEqual([
      'pending',
      'pending',
    ]);
    expect(await jobsOf(prisma, INVITATION_QUEUE.name)).toHaveLength(2);
  });

  it('a second click sends one email only (one after the other, and both at once)', async () => {
    await addEmail('1001');
    expect((await send(['1001'])).status).toBe(202);
    const again = await send(['1001']);
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('EMAIL_ALREADY_QUEUED');
    expect(await invitesOf('1001')).toHaveLength(1);

    await addEmail('1004');
    const bounced = (await invitesOf('1004')).length;
    const both = await Promise.all([send(['1004']), send(['1004'])]);
    expect(both.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(await invitesOf('1004')).toHaveLength(bounced + 1);
    expect(await jobsOf(prisma, INVITATION_QUEUE.name)).toHaveLength(2);
  });

  it('refuses an expired link, a closed round and an inactive employee', async () => {
    await addEmail('1001');
    await prisma.employee.update({ where: { id: world.emp['1001'] }, data: { isActive: false } });
    expect(errorOf(await send(['1001'])).code).toBe('EMPLOYEE_INACTIVE');
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(errorOf(await send(['1001'])).code).toBe('LINK_EXPIRED');
    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'closed' } });
    expect(errorOf(await send(['1001'])).code).toBe('ROUND_NOT_OPEN');
  });

  it('logs one audit row per row: ids and statuses, never an address or a name', async () => {
    const email = await addEmail('1001');
    await send(['1001']);
    const rows = await prisma.auditLog.findMany({ where: { action: 'assignment.manual_send' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'assignment',
      entityId: idOf('1001'),
      userId: world.managerId,
    });
    expect(rows[0]?.details).toMatchObject({
      roundId: round.roundId,
      fromStatus: 'no_email',
      toStatus: 'pending',
      valuesSaved: false,
    });
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    const text = JSON.stringify(rows.map(({ details }) => details));
    for (const secret of [email, employee.firstName, employee.lastName, employee.idNumber]) {
      expect(text).not.toContain(secret);
    }
  });

  it('404 for an unknown id; 400 for a bad body', async () => {
    const unknown = await postManual(
      app,
      'send',
      { assignmentIds: ['00000000-0000-4000-8000-000000000000'] },
      world.managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('ASSIGNMENT_NOT_FOUND');
    expect((await postManual(app, 'send', { assignmentIds: [] }, world.managerCookie)).status).toBe(
      400,
    );
  });

  it('is manager only: officer 403, signed out 401, nothing sent', async () => {
    await addEmail('1001');
    const officer = await send(['1001'], world.officerCookie);
    expect(officer.status).toBe(403);
    expect((await send(['1001'], null)).status).toBe(401);
    expect(await invitesOf('1001')).toHaveLength(0);
  });
});
