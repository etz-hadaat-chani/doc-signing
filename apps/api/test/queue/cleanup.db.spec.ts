import { randomBytes } from 'node:crypto';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { CLEANUP_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { QueueService } from '../../src/common/queue/queue.service.js';
import { AuthCleanupService } from '../../src/modules/auth/auth-cleanup.service.js';
import { createTestApp } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let app: INestApplication;
let prisma: PrismaService;
let api: QueueService;
let worker: INestApplicationContext | undefined;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  api = app.get(QueueService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await clearQueueJobs(prisma);
});

afterEach(async () => {
  if (worker) await closeTestWorker(worker);
  worker = undefined;
});

afterAll(async () => {
  await app.close();
});

/** A session row: logged in at `loginAt`, last request at `lastUsedAt`. */
async function addSession(userId: string, loginAt: Date, lastUsedAt: Date): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(loginAt.getTime() + 12 * HOUR),
      lastUsedAt,
    },
  });
  return session.id;
}

/** One session and one login attempt of each kind; returns the ids that must survive. */
async function seedRows(now: Date): Promise<{ freshSession: string; freshAttempt: bigint }> {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const user = await prisma.user.create({
    data: {
      fullName: 'מנהלת בדיקה',
      email: 'cleanup@doc-signing.local',
      passwordHash: 'not-used',
      role: 'manager',
    },
  });
  // Past the absolute limit (login 13 h ago), though used a minute ago.
  await addSession(user.id, ago(13 * HOUR), ago(MINUTE));
  // Past the idle limit (no request for 31 min).
  await addSession(user.id, ago(HOUR), ago(31 * MINUTE));
  const freshSession = await addSession(user.id, ago(HOUR), ago(5 * MINUTE));

  await prisma.loginAttempt.create({ data: { email: 'a@x.local', createdAt: ago(48 * HOUR) } });
  await prisma.loginAttempt.create({ data: { email: 'b@x.local', createdAt: ago(25 * HOUR) } });
  const fresh = await prisma.loginAttempt.create({
    data: { email: 'c@x.local', createdAt: ago(HOUR) },
  });
  // Per-IP signing counters (3.13): kept 1 day, like login attempts.
  for (const [hoursAgo, ip] of [
    [48, '10.0.0.1'],
    [25, '10.0.0.2'],
    [1, '10.0.0.3'],
  ] as const) {
    await prisma.signingRateHit.create({
      data: { scope: 'all', ip, windowStart: ago(hoursAgo * HOUR), hits: 3 },
    });
  }
  return { freshSession, freshAttempt: fresh.id };
}

async function remaining() {
  const sessions = await prisma.session.findMany({ select: { id: true } });
  const attempts = await prisma.loginAttempt.findMany({ select: { id: true } });
  const rateHits = await prisma.signingRateHit.findMany({ select: { ip: true } });
  return {
    sessions: sessions.map(({ id }) => id),
    attempts: attempts.map(({ id }) => id),
    rateHits: rateHits.map(({ ip }) => ip),
  };
}

describe('daily cleanup job', () => {
  it('the worker deletes expired sessions and old login attempts, keeps fresh ones', async () => {
    const { freshSession, freshAttempt } = await seedRows(new Date());

    worker = await createTestWorker();
    const id = await api.send(CLEANUP_QUEUE, {});
    if (!id) throw new Error('job not added');
    await waitFor(async () =>
      (await api.findJob(CLEANUP_QUEUE, id))?.state === 'completed' ? true : undefined,
    );

    expect(await remaining()).toEqual({
      sessions: [freshSession],
      attempts: [freshAttempt],
      rateHits: ['10.0.0.3'],
    });
  });

  it('is safe to run twice', async () => {
    const now = new Date();
    await seedRows(now);
    const cleanup = new AuthCleanupService(prisma);

    expect(await cleanup.deleteExpired(now)).toEqual({
      sessions: 2,
      loginAttempts: 2,
      signingSessions: 0,
      signingRateHits: 2,
    });
    expect(await cleanup.deleteExpired(now)).toEqual({
      sessions: 0,
      loginAttempts: 0,
      signingSessions: 0,
      signingRateHits: 0,
    });
  });

  it('is scheduled daily at 03:00 Israel time when the worker starts', async () => {
    worker = await createTestWorker();

    expect(await api.findSchedule(CLEANUP_QUEUE)).toEqual({
      cron: '0 3 * * *',
      timezone: 'Asia/Jerusalem',
    });
  });
});
