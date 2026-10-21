import { createHash } from 'node:crypto';
import type { AssignmentStatus } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { insertRound } from '../setup/tracking.js';

const EMPLOYEES = 1500;
const OTHER_ROUNDS = 5;
const OTHER_ROUND_SIZE = 300;
/** The target in task 3.11: each read under 1 s with 1,500 employees in a round. */
const LIMIT_MS = 1000;
const DAY = 86_400_000;

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  world = await seedRoundsWorld(app, prisma);
});

afterAll(async () => {
  await app.close();
});

/** Ten states in turn: every kind of row the table, the counts and the filters handle. */
const STATES: AssignmentStatus[] = [
  'pending',
  'sent',
  'sent',
  'sent',
  'opened',
  'signed',
  'signed',
  'missing_data',
  'no_email',
  'cancelled',
];

/** One round of these employees, in the ten states, with invitations and email answers. */
async function fillRound(roundId: string, employees: { id: string; departmentId: string }[]) {
  const signedAt = new Date(Date.now() - DAY);
  const created = await prisma.assignment.createManyAndReturn({
    data: employees.map((employee, i) => {
      const status = STATES[i % STATES.length] ?? 'sent';
      const signed = status === 'signed';
      return {
        roundId,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        sourceFileKey: `test/${String(i)}.pdf`,
        status,
        sentAt: signedAt,
        signedAt: signed ? signedAt : null,
        signedFileKey: signed ? `rounds/${roundId}/${String(i)}.pdf` : null,
        signMethod: signed ? ('digital' as const) : null,
        needsApproval: signed && i % 20 === 6,
        lockedAt: status === 'opened' && i % 3 === 0 ? signedAt : null,
        failedAttempts: status === 'opened' && i % 3 === 0 ? 5 : 0,
        reminderCount: status === 'sent' ? 2 : 0,
      };
    }),
    select: { id: true, status: true },
  });
  const emailed = created.filter(
    ({ status }) => status !== 'missing_data' && status !== 'no_email',
  );
  await prisma.emailMessage.createMany({
    data: emailed.map(({ id, status }, i) => {
      const failed = status === 'pending' && i % 2 === 0;
      return {
        assignmentId: id,
        type: 'invite' as const,
        toEmail: 'someone@example.com',
        status: failed ? ('failed' as const) : ('sent' as const),
        tokenHash: failed ? null : createHash('sha256').update(id).digest('hex'),
      };
    }),
  });
  const signedRows = created.filter(({ status }) => status === 'signed');
  await prisma.assignmentResponse.createMany({
    data: signedRows.flatMap(({ id }, i) => [
      { assignmentId: id, key: 'email_choice', value: i % 2 === 0 ? 'email' : 'office' },
      ...(i % 2 === 0
        ? [{ assignmentId: id, key: 'email', value: `given${String(i)}@example.com` }]
        : []),
    ]),
  });
}

it(`reads a round of ${String(EMPLOYEES)} employees, the dashboard and the list in under ${String(LIMIT_MS)} ms each`, async () => {
  const departments = await prisma.department.findMany({ orderBy: { code: 'asc' } });
  await prisma.employee.createMany({
    data: Array.from({ length: EMPLOYEES }, (_, i) => ({
      employeeNumber: String(30_000 + i),
      idNumber: String(400_000_000 + i),
      firstName: ['שרה', 'רבקה', 'רחל', 'לאה'][i % 4] ?? 'שרה',
      lastName: `כהן ${String(i)}`,
      departmentId: departments[i % departments.length]?.id ?? '',
      email: `e${String(i)}@example.com`,
      emailStatus: 'valid' as const,
    })),
  });
  const employees = await prisma.employee.findMany({
    where: { employeeNumber: { gte: '30000', lt: '40000' } },
    select: { id: true, departmentId: true, idNumber: true },
    orderBy: { employeeNumber: 'asc' },
  });
  expect(employees).toHaveLength(EMPLOYEES);

  const bigRound = await insertRound(prisma, world.managerId, {
    name: 'חוזה שנתי 2027',
    linkExpiresAt: new Date(Date.now() + 30 * DAY),
  });
  await fillRound(bigRound, employees);
  for (let r = 0; r < OTHER_ROUNDS; r += 1) {
    const roundId = await insertRound(prisma, world.managerId, {
      name: `סבב ${String(r)}`,
      linkExpiresAt: new Date(Date.now() + (r - 2) * DAY),
      createdAt: new Date(Date.now() - (r + 1) * DAY),
    });
    await fillRound(roundId, employees.slice(r * OTHER_ROUND_SIZE, (r + 1) * OTHER_ROUND_SIZE));
  }
  await prisma.$executeRawUnsafe('ANALYZE');

  const cookie = world.managerCookie;
  const timed = async (name: string, call: () => request.Test) => {
    await call(); // warm-up: the first request of a route also compiles code paths
    const started = performance.now();
    const response = await call();
    const elapsed = performance.now() - started;
    expect(response.status, `${name}: ${JSON.stringify(response.body).slice(0, 300)}`).toBe(200);
    return { name, elapsed, body: response.body as { total?: number } };
  };
  const server = httpServer(app);
  const results = [
    await timed('table page', () =>
      request(server).get(`/api/rounds/${bigRound}/assignments?pageSize=100`).set('Cookie', cookie),
    ),
    await timed('table filtered', () =>
      request(server)
        .get(
          `/api/rounds/${bigRound}/assignments?status=send_failed&status=locked&dept=${departments[0]?.id ?? ''}`,
        )
        .set('Cookie', cookie),
    ),
    await timed('search by name', () =>
      request(server)
        .post(`/api/rounds/${bigRound}/assignments/search`)
        .set('Cookie', cookie)
        .send({ q: 'רחל כהן' }),
    ),
    await timed('search by ID', () =>
      request(server)
        .post(`/api/rounds/${bigRound}/assignments/search`)
        .set('Cookie', cookie)
        .send({ q: employees[700]?.idNumber }),
    ),
    await timed('details', () =>
      request(server).get(`/api/rounds/${bigRound}`).set('Cookie', cookie),
    ),
    await timed('dashboard', () =>
      request(server).get('/api/dashboard/summary').set('Cookie', cookie),
    ),
    await timed('round list', () => request(server).get('/api/rounds').set('Cookie', cookie)),
    await timed('history', () =>
      request(server)
        .get(`/api/employees/${employees[0]?.id ?? ''}/assignments`)
        .set('Cookie', cookie),
    ),
  ];

  expect(results[0]?.body.total).toBe(EMPLOYEES);
  expect(results[3]?.body.total).toBe(1);
  process.stdout.write(
    `3.11 reads: ${results.map(({ name, elapsed }) => `${name} ${elapsed.toFixed(0)} ms`).join(', ')}\n`,
  );
  for (const { name, elapsed } of results) expect(elapsed, name).toBeLessThan(LIMIT_MS);
});
