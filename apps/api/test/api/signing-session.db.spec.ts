import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { AuthCleanupService } from '../../src/modules/auth/auth-cleanup.service.js';
import { createTestApp } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  addReminderLink,
  errorOf,
  signAs,
  type SigningPerson,
  type SigningRound,
  signingRound,
  signServer,
  verifiedCookie,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/** The signing session (3.13, FR-SGN-8, NFR-SEC-4): only its own link, only 15 minutes. */

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
const form = (who: SigningPerson, cookie?: string) => {
  const req = signServer(app).get(`/api/sign/${who.token}/form`);
  return cookie ? req.set('Cookie', cookie) : req;
};
const expectSessionRefused = (response: { status: number; body: unknown }) => {
  expect(response.status).toBe(401);
  expect(errorOf(response as never).code).toBe('SIGN_SESSION_EXPIRED');
};

describe('the signing session', () => {
  it('opens the form of its own link', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    expect((await form(person('1001'), cookie)).status).toBe(200);
  });

  it('no cookie, or a made-up one → 401', async () => {
    expectSessionRefused(await form(person('1001')));
    expectSessionRefused(await form(person('1001'), `sign_sid=${'A'.repeat(43)}`));
    expectSessionRefused(await form(person('1001'), 'sign_sid=short'));
  });

  it('after 15 minutes → 401 (the database clock decides)', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    await prisma.signingSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expectSessionRefused(await form(person('1001'), cookie));
    // The daily cleanup deletes it.
    const counts = await new AuthCleanupService(prisma).deleteExpired(new Date());
    expect(counts.signingSessions).toBe(1);
    expect(await prisma.signingSession.count()).toBe(0);
  });

  it("another employee's session never opens this link", async () => {
    const otherCookie = await verifiedCookie(app, person('1002'));
    expectSessionRefused(await form(person('1001'), otherCookie));
  });

  it("the same employee's other link needs its own ID check (the signed copy's address)", async () => {
    const reminder = await addReminderLink(prisma, person('1001'), 'new-address@example.com');
    const inviteCookie = await verifiedCookie(app, person('1001'));
    expectSessionRefused(await form(reminder, inviteCookie));
    const reminderCookie = await verifiedCookie(app, reminder);
    expect((await form(reminder, reminderCookie)).status).toBe(200);
    expectSessionRefused(await form(person('1001'), reminderCookie));
  });

  it('after signing: the sessions are gone and the link says "already signed"', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    const signed = await signAs(app, person('1001'));
    expect(signed.status).toBe(201);
    const cleared = ((signed.headers['set-cookie'] as unknown as string[]) ?? []).find((line) =>
      line.startsWith('sign_sid='),
    );
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.signingSession.count()).toBe(0);
    const response = await form(person('1001'), cookie);
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('SIGN_ALREADY_SIGNED');
  });
});
