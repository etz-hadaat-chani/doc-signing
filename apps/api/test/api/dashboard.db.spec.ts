import { dashboardSummarySchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  type AssignmentState,
  insertAssignment,
  insertRound,
  setState,
} from '../setup/tracking.js';

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
});

afterAll(async () => {
  await app.close();
});

const DAY = 86_400_000;

/** A round inserted with one assignment per state, employees 1001, 1002, … in order. */
async function roundWith(
  status: 'draft' | 'sending' | 'active' | 'closed' | 'cancelled',
  states: AssignmentState[],
  extra: { createdAt?: Date } = {},
): Promise<string> {
  const roundId = await insertRound(prisma, world.managerId, {
    status,
    sentAt: status === 'draft' ? null : new Date(Date.now() - DAY),
    linkExpiresAt: status === 'draft' ? null : new Date(Date.now() + 30 * DAY),
    ...extra,
  });
  const numbers = Object.keys(world.emp).sort();
  for (const [i, state] of states.entries()) {
    const id = await insertAssignment(prisma, roundId, world.emp[numbers[i] ?? ''] ?? '');
    await setState(prisma, id, world.managerId, state);
  }
  return roundId;
}

async function summary(cookie = world.managerCookie) {
  const response = await request(httpServer(app))
    .get('/api/dashboard/summary')
    .set('Cookie', cookie);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dashboardSummarySchema.parse(response.body);
}

it('counts only sending and active rounds; drafts are reported apart', async () => {
  const active = await roundWith('active', [
    { status: 'signed' },
    { status: 'signed', approval: 'waiting' },
    { status: 'sent' },
    { status: 'opened' },
    { status: 'no_email' },
    { status: 'sent', locked: true },
  ]);
  const sending = await roundWith('sending', [
    { status: 'pending' },
    { status: 'pending', lastInvite: 'failed' },
  ]);
  await roundWith('closed', [{ status: 'signed' }, { status: 'sent' }]);
  await roundWith('cancelled', [{ status: 'cancelled' }]);
  await roundWith('draft', [{ status: 'pending' }], { createdAt: new Date(Date.now() - 4 * DAY) });
  await roundWith('draft', [{ status: 'pending' }]);

  const result = await summary();
  expect(result.activeRounds).toBe(2);
  expect(result.rounds.map(({ id }) => id).sort()).toEqual([active, sending].sort());
  expect(result.totals.total).toBe(8);
  expect(result.totals.byStatus).toMatchObject({
    signed: 1,
    waiting_for_approval: 1,
    sent: 1,
    opened: 1,
    no_email: 1,
    locked: 1,
    pending: 1,
    send_failed: 1,
    cancelled: 0,
  });
  // 2 signed of 8.
  expect(result.totals.percentSigned).toBe(25);
  const activeRow = result.rounds.find(({ id }) => id === active);
  expect(activeRow).toMatchObject({
    status: 'active',
    statusLabel: 'פעיל',
    total: 6,
    percentSigned: 33,
    // waiting for approval, no email, locked.
    needsAttention: 3,
  });
  expect(result.rounds.find(({ id }) => id === sending)).toMatchObject({
    statusLabel: 'בשליחה',
    needsAttention: 1,
  });
  expect(result.drafts).toMatchObject({ count: 2, oldestAgeDays: 4 });
  expect(result.drafts.oldestCreatedAt).not.toBeNull();

  // The officer reads the same summary.
  expect(await summary(world.officerCookie)).toEqual(result);
});

it('is empty without rounds', async () => {
  const result = await summary();
  expect(result).toMatchObject({
    activeRounds: 0,
    rounds: [],
    totals: { total: 0, percentSigned: null },
    drafts: { count: 0, oldestCreatedAt: null, oldestAgeDays: null },
  });
});
