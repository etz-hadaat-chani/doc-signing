import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { type SigningPerson, signingRound } from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/** The 3.13 tables and their database rules. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let who: SigningPerson;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  const round = await signingRound(app, prisma, world, ['1001']);
  const found = round.people['1001'];
  if (!found) throw new Error('no person');
  who = found;
});

afterAll(async () => {
  await app.close();
});

const session = (tokenHash: string) =>
  prisma.signingSession.create({
    data: {
      tokenHash,
      assignmentId: who.assignmentId,
      emailMessageId: who.emailMessageId,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

describe('signing_sessions', () => {
  it('stores only a SHA-256 hex hash, once', async () => {
    const hash = 'a'.repeat(64);
    await session(hash);
    await expect(session(hash)).rejects.toThrow();
    await expect(session('not-a-hash')).rejects.toThrow();
    await expect(session('A'.repeat(64))).rejects.toThrow();
  });

  it('belongs to a real assignment and email row', async () => {
    await expect(
      prisma.signingSession.create({
        data: {
          tokenHash: 'b'.repeat(64),
          assignmentId: randomUUID(),
          emailMessageId: who.emailMessageId,
          expiresAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('signing_rate_hits', () => {
  it('counts are positive and scopes are short names', async () => {
    const row = { ip: '10.0.0.1', windowStart: new Date(), hits: 1 };
    await prisma.signingRateHit.create({ data: { scope: 'verify', ...row } });
    await expect(
      prisma.signingRateHit.create({ data: { scope: 'verify', ...row } }),
    ).rejects.toThrow();
    await expect(
      prisma.signingRateHit.create({ data: { scope: 'all', ...row, hits: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.signingRateHit.create({ data: { scope: 'DROP TABLE', ...row } }),
    ).rejects.toThrow();
  });
});

describe('email_messages', () => {
  it('one signed copy per assignment, however it is added', async () => {
    const copy = {
      assignmentId: who.assignmentId,
      type: 'signed_copy' as const,
      toEmail: who.email,
    };
    await prisma.emailMessage.create({ data: copy });
    await expect(prisma.emailMessage.create({ data: copy })).rejects.toThrow();
  });
});

describe('assignments.failed_attempts', () => {
  it('never goes above 5', async () => {
    await expect(
      prisma.assignment.update({ where: { id: who.assignmentId }, data: { failedAttempts: 6 } }),
    ).rejects.toThrow();
  });
});
