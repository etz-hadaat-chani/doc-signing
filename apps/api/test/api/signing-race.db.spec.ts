import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { SIGNED_COPY_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { createTestApp } from '../setup/app.js';
import { jobsOf, postAction } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  type SigningPerson,
  type SigningRound,
  signingRound,
  signServer,
  validSubmit,
  verifiedCookie,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/** Requests at the same moment (3.13): one signature, one file, one email; cancel vs sign. */

const NUMBERS = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008', '1009', '1010'];

let app: INestApplication;
let prisma: PrismaService;
let storage: StorageAdapter;
let world: RoundsWorld;
let round: SigningRound;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  storage = app.get(StorageAdapter);
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, NUMBERS);
});

beforeEach(async () => {
  await clearQueueJobs(prisma);
});

afterAll(async () => {
  await app.close();
});

const person = (number: string): SigningPerson => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};
const submit = (who: SigningPerson, cookie: string) =>
  signServer(app).post(`/api/sign/${who.token}/submit`).set('Cookie', cookie).send(validSubmit());

describe('two submits at once ×5', () => {
  it.each(NUMBERS.slice(0, 5))('employee %s: signed once, one file, one copy', async (number) => {
    const who = person(number);
    const cookie = await verifiedCookie(app, who);
    const responses = await Promise.all([submit(who, cookie), submit(who, cookie)]);
    const statuses = responses.map(({ status }) => status).sort();
    expect(statuses[0]).toBe(201);
    // The other one finds it signed (or its session already ended by the first).
    expect([401, 409]).toContain(statuses[1]);

    const row = await prisma.assignment.findUniqueOrThrow({ where: { id: who.assignmentId } });
    expect(row.status).toBe('signed');
    const base = `rounds/${round.roundId}/${row.signedFileKey?.split('/')[2] ?? ''}/${number}`;
    expect(row.signedFileKey).toBe(`${base}.pdf`);
    expect(await storage.exists(`${base}-2.pdf`)).toBe(false);
    expect(
      await prisma.emailMessage.count({
        where: { assignmentId: who.assignmentId, type: 'signed_copy' },
      }),
    ).toBe(1);
    expect(await jobsOf(prisma, SIGNED_COPY_QUEUE.name)).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'assignment.signed', entityId: who.assignmentId },
      }),
    ).toBe(1);
  });
});

describe('cancel and submit at once ×5', () => {
  it.each(NUMBERS.slice(5))(
    'employee %s: either signed or cancelled, never both',
    async (number) => {
      const who = person(number);
      const cookie = await verifiedCookie(app, who);
      const [signed, cancelled] = await Promise.all([
        submit(who, cookie),
        postAction(app, `/api/assignments/${who.assignmentId}/cancel`, world.managerCookie),
      ]);
      const row = await prisma.assignment.findUniqueOrThrow({ where: { id: who.assignmentId } });
      const copies = await prisma.emailMessage.count({
        where: { assignmentId: who.assignmentId, type: 'signed_copy' },
      });
      if (row.status === 'signed') {
        expect(signed.status).toBe(201);
        expect(cancelled.status).toBe(409);
        expect(copies).toBe(1);
      } else {
        expect(row.status).toBe('cancelled');
        expect(cancelled.status).toBe(200);
        expect(signed.status).toBe(409);
        expect(row.signedFileKey).toBeNull();
        expect(copies).toBe(0);
        expect(await jobsOf(prisma, SIGNED_COPY_QUEUE.name)).toEqual([]);
      }
    },
  );
});
