import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { postAction } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  errorOf,
  signCookieOf,
  type SigningPerson,
  type SigningRound,
  signingRound,
  signServer,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/** The ID check (3.13, FR-SGN-2, NFR-SEC-3): open, wrong, lock, unlock, typos, audit. */

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

const person = (number: string): SigningPerson => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};
const verify = (who: SigningPerson, idNumber: string) =>
  signServer(app).post(`/api/sign/${who.token}/verify`).send({ idNumber });
const rowOf = (who: SigningPerson) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: who.assignmentId } });
const audits = (action: string) =>
  prisma.auditLog.findMany({ where: { action }, orderBy: { id: 'asc' } });

/** A valid ID number (right check digit) that isn't hers. */
const OTHER_ID = '039337423';

describe('POST /api/sign/:token/verify', () => {
  it('the right number opens it: "Opened", first_opened_at, a session cookie', async () => {
    const response = await verify(person('1001'), person('1001').idNumber);
    expect(response.status).toBe(200);
    const body = response.body as { sessionExpiresAt: string };
    const minutes = (Date.parse(body.sessionExpiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    const line = ((response.headers['set-cookie'] as unknown as string[]) ?? []).find((value) =>
      value.startsWith('sign_sid='),
    );
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/SameSite=Strict/i);
    expect(line).toMatch(/Path=\/api\/sign(;|$)/);
    expect(line).not.toMatch(/Max-Age|Expires/i);

    const row = await rowOf(person('1001'));
    expect(row.status).toBe('opened');
    expect(row.firstOpenedAt).not.toBeNull();
    const [audit] = await audits('sign.verified');
    expect(audit).toMatchObject({
      actorType: 'employee',
      entityId: row.id,
      details: { fromStatus: 'sent', emailMessageId: person('1001').emailMessageId },
    });
    const sessions = await prisma.signingSession.findMany();
    expect(sessions).toHaveLength(1);
    // Only the token's hash is stored, never the cookie value.
    expect(signCookieOf(response)).not.toContain(sessions[0]?.tokenHash ?? '-');
  });

  it('from "waiting to send" too; a second check keeps "Opened" and the first time', async () => {
    await prisma.assignment.update({
      where: { id: person('1001').assignmentId },
      data: { status: 'pending' },
    });
    expect((await verify(person('1001'), person('1001').idNumber)).status).toBe(200);
    const first = await rowOf(person('1001'));
    expect(first.status).toBe('opened');
    expect((await verify(person('1001'), person('1001').idNumber)).status).toBe(200);
    expect((await rowOf(person('1001'))).firstOpenedAt).toEqual(first.firstOpenedAt);
  });

  it('a number typed without its leading zero is accepted', async () => {
    expect(person('1001').idNumber.startsWith('0')).toBe(true);
    const response = await verify(person('1001'), person('1001').idNumber.slice(1));
    expect(response.status).toBe(200);
  });

  it('wrong numbers count down; the 5th locks; the 6th is refused even when right', async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await verify(person('1001'), OTHER_ID);
      expect(response.status).toBe(401);
      expect(errorOf(response)).toMatchObject({
        code: 'SIGN_ID_MISMATCH',
        details: { attemptsLeft: 5 - attempt },
      });
    }
    const fifth = await verify(person('1001'), OTHER_ID);
    expect(fifth.status).toBe(423);
    expect(errorOf(fifth)).toMatchObject({ code: 'SIGN_LOCKED', details: { state: 'locked' } });
    const locked = await rowOf(person('1001'));
    expect(locked.failedAttempts).toBe(5);
    expect(locked.lockedAt).not.toBeNull();
    expect(locked.status).toBe('sent');

    const sixth = await verify(person('1001'), person('1001').idNumber);
    expect(sixth.status).toBe(423);
    expect(signCookieOf(sixth)).toBe('');
    expect((await rowOf(person('1001'))).failedAttempts).toBe(5);
    expect(await prisma.signingSession.count()).toBe(0);

    expect(await audits('sign.verify_failed')).toHaveLength(5);
    expect(await audits('sign.locked')).toHaveLength(1);
    const [refused] = await audits('sign.verify_refused');
    expect(refused?.details).toMatchObject({ state: 'locked' });
    // The other employee's link is untouched.
    expect((await rowOf(person('1002'))).failedAttempts).toBe(0);
  });

  it('an unlock restarts the count: 5 more tries, and the right number works', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) await verify(person('1001'), OTHER_ID);
    const unlock = await postAction(
      app,
      `/api/assignments/${person('1001').assignmentId}/unlock`,
      world.managerCookie,
    );
    expect(unlock.status).toBe(200);
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect((await verify(person('1001'), OTHER_ID)).status).toBe(401);
    }
    expect((await verify(person('1001'), person('1001').idNumber)).status).toBe(200);
    // A correct number does not reset the count (only an unlock does).
    expect((await rowOf(person('1001'))).failedAttempts).toBe(4);
  });

  it.each([
    ['a wrong check digit', '012345675'],
    ['letters', 'abc'],
    ['too many digits', '1234567890'],
    ['nothing', ''],
  ])('%s → 400 INVALID_ID_NUMBER, not counted', async (_label, typed) => {
    const response = await verify(person('1001'), typed);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('INVALID_ID_NUMBER');
    expect((await rowOf(person('1001'))).failedAttempts).toBe(0);
  });

  it.each([
    ['no body', undefined],
    ['a number instead of text', { idNumber: 12345674 }],
    ['an extra field', { idNumber: '012345674', token: 'x' }],
  ])('%s → 400 VALIDATION_FAILED', async (_label, body) => {
    const response = await signServer(app)
      .post(`/api/sign/${person('1001').token}/verify`)
      .send(body);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('never stores the number typed: not in an audit row', async () => {
    await verify(person('1001'), OTHER_ID);
    await verify(person('1001'), person('1001').idNumber);
    const rows = await prisma.auditLog.findMany();
    const text = JSON.stringify(rows.map(({ details }) => details));
    for (const secret of [OTHER_ID, person('1001').idNumber, person('1001').idNumber.slice(1)]) {
      expect(text).not.toContain(secret);
    }
  });

  it('a staff cookie gives nothing: the ID check is still needed', async () => {
    const response = await signServer(app)
      .get(`/api/sign/${person('1001').token}/form`)
      .set('Cookie', world.managerCookie);
    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('SIGN_SESSION_EXPIRED');
  });
});
