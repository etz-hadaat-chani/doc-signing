import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { QUEUE_SCHEMA } from '../../src/common/queue/queue.definitions.js';
import { createTestApp } from '../setup/app.js';
import { kioskServer, kioskVerified, openKiosk } from '../setup/kiosk.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { type SigningRound, signingRound, validSubmit } from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * Privacy at the office kiosk (3.16, NFR-PRV-7, NFR-SEC-1): open, a wrong and a right ID
 * number, document, form, fit, submit; then every log line, audit row and job is searched for
 * the kiosk code, the ID number, the addresses and the names. None may be there.
 */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;
const logLines: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, ['1001']);
  logLines.length = 0;
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...parts: unknown[]) => {
      logLines.push(parts.map(String).join(' '));
    });
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('no code, ID number, address or name leaves the kiosk flow', () => {
  it('in logs, audit rows or job data', async () => {
    const who = round.people['1001'];
    if (!who) throw new Error('no person');
    const typedAddress = freshEmail('kiosk-privacy');
    const kiosk = () => kioskServer(app);

    const first = await openKiosk(app, who.assignmentId, world.managerCookie);
    const { code } = await openKiosk(app, who.assignmentId, world.managerCookie);
    await kiosk().post('/api/kiosk/state').send({ code });
    await kiosk().post('/api/kiosk/verify').send({ code, idNumber: '039337423' });
    await kiosk().post('/api/kiosk/verify').send({ code: first.code, idNumber: who.idNumber });
    const cookie = await kioskVerified(app, code, who.idNumber);
    await kiosk().get('/api/kiosk/document').set('Cookie', cookie);
    await kiosk().get('/api/kiosk/form').set('Cookie', cookie);
    await kiosk()
      .post('/api/kiosk/fit')
      .set('Cookie', cookie)
      .send({ answers: { nickname: 'דנה' } });
    const signed = await kiosk()
      .post('/api/kiosk/submit')
      .set('Cookie', cookie)
      .send(validSubmit({ email: typedAddress }));
    expect(signed.status).toBe(201);

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: who.employeeId } });
    const audits = await prisma.auditLog.findMany();
    const jobs = await prisma.$queryRawUnsafe<{ data: unknown }[]>(
      `SELECT data FROM "${QUEUE_SCHEMA}".job`,
    );
    const haystacks = {
      logs: logLines.join('\n'),
      audit: JSON.stringify(audits.map(({ details, action }) => ({ action, details }))),
      jobs: JSON.stringify(jobs),
    };
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['assignment.kiosk_opened', 'sign.verified', 'assignment.signed']),
    );
    const secrets = {
      code,
      firstCode: first.code,
      idNumber: who.idNumber,
      idWithoutZero: who.idNumber.replace(/^0+/, ''),
      typedAddress,
      storedAddress: who.email,
      firstName: employee.firstName,
      lastName: employee.lastName,
      typedName: 'דנה כהן',
    };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const [what, secret] of Object.entries(secrets)) {
        expect(text.includes(secret), `${what} found in ${where}`).toBe(false);
      }
    }
  });
});
