import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { REMINDER_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { createTestApp } from '../setup/app.js';
import { dailyReminders, inDays } from '../setup/daily-reminders.js';
import { jobsOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { insertRound } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

const EMPLOYEES = 1500;
/** The target in task 3.14: 1,500 due reminders queued (rows and jobs), no worker. */
const LIMIT_MS = 3000;
/** The whole test, not the stopwatch: inserting 1,500 rows takes longer than Vitest's 5 s default on the slow CI runner. */
const TEST_TIMEOUT_MS = 60_000;

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
});

afterAll(async () => {
  await app.close();
});

it(
  `queues ${String(EMPLOYEES)} due reminders in under ${String(LIMIT_MS)} ms`,
  async () => {
    // Made-up employees, all sent the invitation four days ago (interval 3: all due).
    await prisma.employee.createMany({
      data: Array.from({ length: EMPLOYEES }, (_, i) => ({
        employeeNumber: String(30_000 + i),
        idNumber: String(600_000_000 + i),
        firstName: 'שרה',
        lastName: `כהן ${String(i)}`,
        departmentId: world.dept[15],
        email: `d${String(i)}@example.com`,
        emailStatus: 'valid' as const,
      })),
    });
    const employees = await prisma.employee.findMany({
      where: { employeeNumber: { gte: '30000' } },
      select: { id: true, departmentId: true },
    });
    const sentAt = inDays(-4);
    const roundId = await insertRound(prisma, world.managerId, {
      sentAt,
      linkExpiresAt: inDays(30),
    });
    await prisma.assignment.createMany({
      data: employees.map((employee) => ({
        roundId,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        sourceFileKey: `test/${employee.id}.pdf`,
        status: 'sent' as const,
        sentAt,
      })),
    });
    const assignments = await prisma.assignment.findMany({
      where: { roundId },
      select: { id: true },
    });
    await prisma.emailMessage.createMany({
      data: assignments.map(({ id }) => ({
        assignmentId: id,
        type: 'invite' as const,
        toEmail: 'someone@example.com',
        status: 'sent' as const,
        tokenHash: createHash('sha256').update(id).digest('hex'),
        sentAt,
        createdAt: sentAt,
      })),
    });
    const { service } = dailyReminders(app, prisma);

    const started = performance.now();
    const result = await service.run();
    const elapsed = performance.now() - started;

    expect(result.queued).toBe(EMPLOYEES);
    expect(await jobsOf(prisma, REMINDER_QUEUE.name)).toHaveLength(EMPLOYEES);
    expect(await prisma.emailMessage.count({ where: { type: 'reminder', status: 'queued' } })).toBe(
      EMPLOYEES,
    );
    process.stdout.write(
      `3.14 daily reminders of ${String(EMPLOYEES)}: ${elapsed.toFixed(0)} ms\n`,
    );
    expect(elapsed).toBeLessThan(LIMIT_MS);
  },
  TEST_TIMEOUT_MS,
);
