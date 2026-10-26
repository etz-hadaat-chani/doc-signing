import type { SignVerifiedResult } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { SIGNED_COPY_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { createTestApp } from '../setup/app.js';
import { kioskCookieOf, kioskServer, kioskVerified, openKiosk } from '../setup/kiosk.js';
import { messagesTo } from '../setup/mailpit.js';
import { errorOf, jobsOf, postAction } from '../setup/round-actions.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  type SigningRound,
  signingRound,
  signServer,
  validSubmit,
  verifiedCookie,
} from '../setup/signing.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

/**
 * Signing at the office signing station (3.16 part B, FR-MAN-4): the same steps as a link (ID
 * check, document, form, fit, submit), reached with the one-time code; `kiosk` + `handled_by`.
 */

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
  round = await signingRound(app, prisma, world, ['1001', '1002']);
});

afterAll(async () => {
  await app.close();
});

const person = (number: string) => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};
const rowOf = (assignmentId: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
const kiosk = () => kioskServer(app);
const submitWith = (cookie: string, body: object = validSubmit()) =>
  kiosk().post('/api/kiosk/submit').set('Cookie', cookie).send(body);

/** Opens a kiosk for the person as the manager and passes the ID check there. */
async function atKiosk(number: string) {
  const who = person(number);
  const opened = await openKiosk(app, who.assignmentId, world.managerCookie);
  const cookie = await kioskVerified(app, opened.code, who.idNumber);
  return { who, code: opened.code, cookie };
}

describe('signing at the office kiosk', () => {
  it('state → verify → document → form → fit → submit: signed by kiosk, handled by the manager', async () => {
    const who = person('1001');
    const { code } = await openKiosk(app, who.assignmentId, world.managerCookie);
    const state = await kiosk().post('/api/kiosk/state').send({ code });
    expect(state.body).toMatchObject({ state: 'valid' });

    const verified = await kiosk().post('/api/kiosk/verify').send({ code, idNumber: who.idNumber });
    expect(verified.status).toBe(200);
    const minutes =
      (new Date((verified.body as SignVerifiedResult).sessionExpiresAt).getTime() - Date.now()) /
      60_000;
    expect(minutes).toBeGreaterThan(14.5);
    const setCookie = (verified.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/kiosk_sid=.+; Path=\/api\/kiosk; HttpOnly; Secure; SameSite=Strict/);
    const cookie = kioskCookieOf(verified);
    expect((await rowOf(who.assignmentId)).status).toBe('opened');

    const document = await kiosk().get('/api/kiosk/document').set('Cookie', cookie);
    expect(document.status).toBe(200);
    expect(document.headers['content-type']).toBe('application/pdf');
    expect(document.headers['cache-control']).toBe('no-store');
    expect(document.headers['x-frame-options']).toBe('DENY');
    const form = await kiosk().get('/api/kiosk/form').set('Cookie', cookie);
    expect(form.status).toBe(200);
    expect(form.body).toMatchObject({ emailPrefill: who.email, correctionNote: null });
    const fit = await kiosk()
      .post('/api/kiosk/fit')
      .set('Cookie', cookie)
      .send({ answers: { nickname: 'דנה' } });
    expect(fit.body).toEqual({ tooLong: [] });

    const given = freshEmail('kiosk-given');
    const signed = await submitWith(cookie, validSubmit({ email: given.toUpperCase() }));
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    expect(signed.body).toMatchObject({ state: 'signed' });
    expect((signed.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(
      /kiosk_sid=;.*Expires=Thu, 01 Jan 1970/,
    );

    const row = await rowOf(who.assignmentId);
    expect(row).toMatchObject({
      status: 'signed',
      signMethod: 'kiosk',
      handledById: world.managerId,
      signedFileKey: `rounds/${round.roundId}/15/1001.pdf`,
      needsApproval: true,
    });
    expect(row.signedFileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.signerIp).not.toBeNull();
    expect(
      await prisma.assignmentResponse.count({ where: { assignmentId: who.assignmentId } }),
    ).toBeGreaterThan(3);
    expect(await prisma.signingSession.count({ where: { assignmentId: who.assignmentId } })).toBe(
      0,
    );
    const session = await prisma.kioskSession.findFirstOrThrow({
      where: { assignmentId: who.assignmentId },
    });
    expect(session).toMatchObject({ endReason: 'signed' });
    expect(session.usedAt).not.toBeNull();

    // The signed copy goes to the address she gave, lowercased; one job, ids only.
    const copy = await prisma.emailMessage.findFirstOrThrow({
      where: { assignmentId: who.assignmentId, type: 'signed_copy' },
    });
    expect(copy).toMatchObject({ toEmail: given, status: 'queued' });
    expect(await jobsOf(prisma, SIGNED_COPY_QUEUE.name)).toEqual([
      {
        data: { assignmentId: who.assignmentId, emailMessageId: copy.id },
        singletonKey: who.assignmentId,
      },
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.signed' },
    });
    expect(audit).toMatchObject({ actorType: 'employee', entityId: who.assignmentId });
    expect(audit.details).toMatchObject({
      roundId: round.roundId,
      emailMessageId: null,
      signMethod: 'kiosk',
      kioskSessionId: session.id,
      handledById: world.managerId,
      signedCopyEmailId: copy.id,
      emailChoice: 'email',
      fileSha256: row.signedFileSha256,
    });

    // Every link now shows "already signed"; reminders are refused; the kiosk is over.
    const link = await signServer(app).get(`/api/sign/${who.token}`);
    expect(link.body).toMatchObject({ state: 'signed' });
    const remind = await postAction(
      app,
      `/api/assignments/${who.assignmentId}/remind`,
      world.managerCookie,
    );
    expect(errorOf(remind).code).toBe('ASSIGNMENT_ALREADY_SIGNED');
    expect((await kiosk().get('/api/kiosk/document').set('Cookie', cookie)).status).toBe(401);
    expect((await kiosk().post('/api/kiosk/state').send({ code })).status).toBe(404);
  });

  it('"at the office" chosen: no signed copy', async () => {
    const { who, cookie } = await atKiosk('1001');
    const signed = await submitWith(
      cookie,
      validSubmit({ emailChoice: 'office', email: undefined }),
    );
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    expect(await prisma.emailMessage.count({ where: { type: 'signed_copy' } })).toBe(0);
    expect(await jobsOf(prisma, SIGNED_COPY_QUEUE.name)).toEqual([]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.signed' },
    });
    expect(audit.details).toMatchObject({ emailChoice: 'office', signedCopyEmailId: null });
    expect((await rowOf(who.assignmentId)).status).toBe('signed');
  });

  it('the copy reaches the given address through the real worker', async () => {
    const { cookie } = await atKiosk('1001');
    const given = freshEmail('kiosk-mailpit');
    expect((await submitWith(cookie, validSubmit({ email: given }))).status).toBe(201);
    const worker = await createTestWorker();
    try {
      const [message] = await messagesTo(given, 1);
      expect(message?.Attachments?.length).toBe(1);
      await waitFor(async () => {
        const copy = await prisma.emailMessage.findFirst({ where: { type: 'signed_copy' } });
        return copy?.status === 'sent' ? true : undefined;
      });
    } finally {
      await closeTestWorker(worker);
    }
    expect(await messagesTo(person('1001').email, 0, 200)).toEqual([]);
  });
});

describe('the kiosk still guards like a link', () => {
  it('needs the ID number: the code alone opens nothing but the ID check', async () => {
    const who = person('1001');
    const { code } = await openKiosk(app, who.assignmentId, world.managerCookie);
    for (const path of ['/api/kiosk/document', '/api/kiosk/form']) {
      const response = await kiosk().get(path);
      expect(response.status, path).toBe(401);
      expect(errorOf(response).code).toBe('SIGN_SESSION_EXPIRED');
    }
    const submit = await kiosk()
      .post('/api/kiosk/submit')
      .send({ ...validSubmit(), code });
    expect(submit.status).toBe(400);
    expect((await submitWith('kiosk_sid=made-up')).status).toBe(401);
    expect((await rowOf(who.assignmentId)).status).toBe('sent');
  });

  it('a staff cookie alone gives nothing; the two signing cookies never cross', async () => {
    const who = person('1001');
    for (const path of ['/api/kiosk/document', '/api/kiosk/form']) {
      const response = await kiosk().get(path).set('Cookie', world.managerCookie);
      expect(response.status, path).toBe(401);
    }
    expect((await submitWith(world.managerCookie)).status).toBe(401);
    const noCode = await kiosk()
      .post('/api/kiosk/state')
      .set('Cookie', world.managerCookie)
      .send({});
    expect(noCode.status).toBe(400);

    const linkCookie = await verifiedCookie(app, who);
    expect((await kiosk().get('/api/kiosk/form').set('Cookie', linkCookie)).status).toBe(401);
    const { cookie } = await atKiosk('1002');
    const other = person('1002');
    const viaLink = await signServer(app)
      .get(`/api/sign/${other.token}/form`)
      .set('Cookie', cookie);
    expect(viaLink.status).toBe(401);
    expect((await rowOf(who.assignmentId)).status).toBe('opened');
    expect((await rowOf(other.assignmentId)).signedAt).toBeNull();
  });

  it('a used, replaced or old code is refused with one answer', async () => {
    const who = person('1001');
    const { code } = await atKiosk('1001');
    const used = await kiosk().post('/api/kiosk/verify').send({ code, idNumber: who.idNumber });
    expect(used.status).toBe(404);
    expect(errorOf(used).code).toBe('KIOSK_CODE_NOT_FOUND');

    const old = await openKiosk(app, who.assignmentId, world.managerCookie);
    await prisma.kioskSession.updateMany({
      where: { assignmentId: who.assignmentId, endedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const bodies = {
      '/api/kiosk/state': { code: old.code },
      '/api/kiosk/verify': { code: old.code, idNumber: who.idNumber },
    };
    for (const [path, body] of Object.entries(bodies)) {
      const response = await kiosk().post(path).send(body);
      expect(response.status, path).toBe(404);
      expect(errorOf(response).code).toBe('KIOSK_CODE_NOT_FOUND');
    }
    for (const made of ['A'.repeat(43), 'short']) {
      expect((await kiosk().post('/api/kiosk/state').send({ code: made })).status).toBe(404);
    }
  });

  it('wrong ID numbers count with her link, a typo does not, the 5th locks the row', async () => {
    const who = person('1001');
    for (let i = 0; i < 3; i += 1) {
      await signServer(app).post(`/api/sign/${who.token}/verify`).send({ idNumber: '039337423' });
    }
    const { code } = await openKiosk(app, who.assignmentId, world.managerCookie);
    const verify = (idNumber: string) => kiosk().post('/api/kiosk/verify').send({ code, idNumber });
    const typo = await verify('12');
    expect(typo.status).toBe(400);
    expect(errorOf(typo).code).toBe('INVALID_ID_NUMBER');
    const fourth = await verify('039337423');
    expect(fourth.status).toBe(401);
    expect(errorOf(fourth).details).toEqual({ attemptsLeft: 1 });
    const fifth = await verify('039337423');
    expect(fifth.status).toBe(423);
    expect(errorOf(fifth).code).toBe('SIGN_LOCKED');

    const row = await rowOf(who.assignmentId);
    expect(row.failedAttempts).toBe(5);
    expect(row.lockedAt).not.toBeNull();
    const session = await prisma.kioskSession.findFirstOrThrow({
      where: { assignmentId: who.assignmentId },
    });
    expect(session.endReason).toBe('locked');
    expect((await verify(who.idNumber)).status).toBe(404);
    const reopen = await kiosk()
      .post(`/api/assignments/${who.assignmentId}/kiosk`)
      .set('Cookie', world.managerCookie);
    expect(errorOf(reopen).code).toBe('ASSIGNMENT_LOCKED');
    const actions = await prisma.auditLog.findMany({
      where: { entityId: who.assignmentId, action: { startsWith: 'sign.' } },
      orderBy: { id: 'asc' },
    });
    expect(actions.map(({ action }) => action).slice(-3)).toEqual([
      'sign.verify_failed',
      'sign.verify_failed',
      'sign.locked',
    ]);
    expect(actions.at(-1)?.details).toMatchObject({ emailMessageId: null, failedAttempts: 5 });
  });

  it('a no-email row signs at the kiosk; it stays no_email until it signs', async () => {
    const who = person('1001');
    await prisma.assignment.update({
      where: { id: who.assignmentId },
      data: { status: 'no_email' },
    });
    const { cookie } = await atKiosk('1001');
    const opened = await rowOf(who.assignmentId);
    expect(opened.status).toBe('no_email');
    expect(opened.firstOpenedAt).not.toBeNull();
    const office = validSubmit({ emailChoice: 'office', email: undefined });
    expect((await submitWith(cookie, office)).status).toBe(201);
    expect((await rowOf(who.assignmentId)).status).toBe('signed');
  });

  it('after the link expired: the link refuses, the kiosk signs', async () => {
    const who = person('1001');
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 60_000) },
    });
    const link = await signServer(app).get(`/api/sign/${who.token}`);
    expect(link.body).toMatchObject({ state: 'expired' });
    const { cookie } = await atKiosk('1001');
    expect((await submitWith(cookie)).status).toBe(201);
  });

  it('signing at the kiosk ends her open link session', async () => {
    const who = person('1001');
    const linkCookie = await verifiedCookie(app, who);
    const { cookie } = await atKiosk('1001');
    expect((await submitWith(cookie)).status).toBe(201);
    const late = await signServer(app)
      .post(`/api/sign/${who.token}/submit`)
      .set('Cookie', linkCookie)
      .send(validSubmit());
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe('SIGN_ALREADY_SIGNED');
  });

  it('two submits at once: one signature, one copy', async () => {
    const who = person('1001');
    const { cookie } = await atKiosk('1001');
    const answers = await Promise.all([submitWith(cookie), submitWith(cookie)]);
    const statuses = answers.map(({ status }) => status).sort();
    expect(statuses[0]).toBe(201);
    expect([401, 404, 409]).toContain(statuses[1]);
    expect(await prisma.emailMessage.count({ where: { type: 'signed_copy' } })).toBe(1);
    const signedRows = await prisma.auditLog.count({
      where: { action: 'assignment.signed', entityId: who.assignmentId },
    });
    expect(signedRows).toBe(1);
  });

  it('a cancel during the kiosk session stops the submit', async () => {
    const who = person('1001');
    const { cookie } = await atKiosk('1001');
    const cancelled = await postAction(
      app,
      `/api/assignments/${who.assignmentId}/cancel`,
      world.managerCookie,
    );
    expect(cancelled.status).toBe(200);
    const submit = await submitWith(cookie);
    expect(submit.status).toBe(409);
    expect(errorOf(submit).code).toBe('SIGN_CANCELLED');
    expect((await rowOf(who.assignmentId)).status).toBe('cancelled');
  });
});
