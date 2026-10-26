import { createHash, randomUUID } from 'node:crypto';
import type { AssignmentStatus } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { kioskServer, kioskVerified, openKiosk, postOpenKiosk } from '../setup/kiosk.js';
import { errorOf, postAction } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { type SigningRound, signingRound } from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/** Opening the office signing station (3.16 part B, FR-MAN-4): who, which rows, one at a time. */

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
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const setRow = (assignmentId: string, data: object) =>
  prisma.assignment.update({ where: { id: assignmentId }, data });
const stateOf = (code: string) => kioskServer(app).post('/api/kiosk/state').send({ code });

describe('POST /api/assignments/:id/kiosk', () => {
  it('opens a 10-minute one-time code; only its hash is stored; logged without it', async () => {
    const { assignmentId } = person('1001');
    const before = Date.now();
    const opened = await openKiosk(app, assignmentId, world.managerCookie);
    expect(opened.assignmentId).toBe(assignmentId);
    expect(opened.kioskPath).toBe('/kiosk');
    expect(opened.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const minutes = (new Date(opened.expiresAt).getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThan(10.1);

    const [row] = await prisma.kioskSession.findMany({ where: { assignmentId } });
    expect(row).toMatchObject({
      codeHash: sha256(opened.code),
      openedById: world.managerId,
      usedAt: null,
      endedAt: null,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.kiosk_opened' },
    });
    expect(audit).toMatchObject({
      actorType: 'user',
      userId: world.managerId,
      entityType: 'assignment',
      entityId: assignmentId,
    });
    expect(audit.details).toEqual({
      roundId: round.roundId,
      kioskSessionId: row?.id,
      expiresAt: opened.expiresAt,
      replaced: 0,
    });
    expect(JSON.stringify(audit.details)).not.toContain(opened.code);

    const state = await stateOf(opened.code);
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ state: 'valid', hrContact: expect.any(Object) as object });
  });

  it.each<AssignmentStatus>(['pending', 'sent', 'opened', 'no_email', 'invalid_email'])(
    'opens for %s, also after the link expired',
    async (status) => {
      const { assignmentId } = person('1001');
      await setRow(assignmentId, { status });
      await openKiosk(app, assignmentId, world.managerCookie);
      await prisma.round.update({
        where: { id: round.roundId },
        data: { linkExpiresAt: new Date(Date.now() - 60_000) },
      });
      const again = await openKiosk(app, assignmentId, world.managerCookie);
      expect((await stateOf(again.code)).body).toMatchObject({ state: 'valid' });
    },
  );

  it('a locked row is unlocked first (the logged unlock), then opens', async () => {
    const { assignmentId } = person('1001');
    await setRow(assignmentId, { lockedAt: new Date(), failedAttempts: 5 });
    const locked = await postOpenKiosk(app, assignmentId, world.managerCookie);
    expect(locked.status).toBe(409);
    expect(errorOf(locked).code).toBe('ASSIGNMENT_LOCKED');
    expect(await prisma.kioskSession.count()).toBe(0);

    const unlocked = await postAction(
      app,
      `/api/assignments/${assignmentId}/unlock`,
      world.managerCookie,
    );
    expect(unlocked.status).toBe(200);
    await openKiosk(app, assignmentId, world.managerCookie);
  });

  it('refuses rows that are done, have nothing saved, or whose round is over', async () => {
    const { assignmentId } = person('1001');
    const signedFile = { signedAt: new Date(), signedFileKey: 'rounds/x/15/1001.pdf' };
    const cases: [object, string][] = [
      [{ status: 'signed', ...signedFile }, 'ASSIGNMENT_ALREADY_SIGNED'],
      [{ status: 'signed_manual', ...signedFile }, 'ASSIGNMENT_ALREADY_SIGNED'],
      [{ status: 'cancelled', cancelledAt: new Date() }, 'ASSIGNMENT_ALREADY_CANCELLED'],
      [{ status: 'missing_data' }, 'ASSIGNMENT_NOT_PRINTABLE'],
    ];
    for (const [data, code] of cases) {
      await setRow(assignmentId, data);
      const response = await postOpenKiosk(app, assignmentId, world.managerCookie);
      expect(response.status, code).toBe(409);
      expect(errorOf(response).code).toBe(code);
    }
    await setRow(assignmentId, { status: 'sent' });
    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'closed' } });
    const closed = await postOpenKiosk(app, assignmentId, world.managerCookie);
    expect(errorOf(closed).code).toBe('ROUND_NOT_OPEN');
    expect(await prisma.kioskSession.count()).toBe(0);
  });

  it('a new kiosk ends the earlier one (its code and its signing session)', async () => {
    const who = person('1001');
    const first = await openKiosk(app, who.assignmentId, world.managerCookie);
    const second = await openKiosk(app, who.assignmentId, world.managerCookie);
    expect((await stateOf(first.code)).status).toBe(404);
    expect((await stateOf(second.code)).status).toBe(200);

    // A session already started from a kiosk ends too when the next one opens.
    const cookie = await kioskVerified(app, second.code, who.idNumber);
    await openKiosk(app, who.assignmentId, world.managerCookie);
    const form = await kioskServer(app).get('/api/kiosk/form').set('Cookie', cookie);
    expect(form.status).toBe(401);
    expect(errorOf(form).code).toBe('SIGN_SESSION_EXPIRED');

    const rows = await prisma.kioskSession.findMany({
      where: { assignmentId: who.assignmentId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map(({ endReason }) => endReason)).toEqual(['replaced', 'replaced', null]);
    const audits = await prisma.auditLog.findMany({
      where: { action: 'assignment.kiosk_opened' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map(({ details }) => (details as { replaced: number }).replaced)).toEqual([
      0, 1, 1,
    ]);
  });

  it('manager only: officer 403, signed out 401, unknown 404, bad id 400', async () => {
    const { assignmentId } = person('1001');
    expect((await postOpenKiosk(app, assignmentId, world.officerCookie)).status).toBe(403);
    expect((await postOpenKiosk(app, assignmentId, null)).status).toBe(401);
    const unknown = await postOpenKiosk(app, randomUUID(), world.managerCookie);
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('ASSIGNMENT_NOT_FOUND');
    expect((await postOpenKiosk(app, 'not-a-uuid', world.managerCookie)).status).toBe(400);
    expect(await prisma.kioskSession.count()).toBe(0);
  });
});
