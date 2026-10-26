import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { INVITATION_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { testPdf } from '../fixtures/pdf.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { getList, manualRound, postManual } from '../setup/manual-handling.js';
import { jobsOf, type SentRound } from '../setup/round-actions.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * Manual handling (3.16 part A) keeps personal data out of logs, audit rows and job data: the
 * list, the send, print and the scan are run, then everything is searched for the employee's
 * ID number, names and email. Made-up employees only.
 */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SentRound;
const logLines: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await manualRound(app, prisma, world);
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

describe('no ID number, name or address leaves manual handling', () => {
  it('in logs, audit rows or job data', async () => {
    const email = freshEmail('private');
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { email, emailStatus: 'valid' },
    });
    const id = (number: string) => round.assignment[number] ?? '';
    const server = request(httpServer(app));
    const cookie = world.managerCookie;

    expect((await getList(app, '', cookie)).status).toBe(200);
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    expect((await postManual(app, 'search', { q: employee.idNumber }, cookie)).status).toBe(200);
    expect((await postManual(app, 'send', { assignmentIds: [id('1001')] }, cookie)).status).toBe(
      202,
    );
    expect(
      (await server.get(`/api/assignments/${id('1003')}/print`).set('Cookie', cookie)).status,
    ).toBe(200);
    const scan = await server
      .post(`/api/assignments/${id('1004')}/manual-sign`)
      .set('Cookie', cookie)
      .attach('file', await testPdf(), 'סריקה.pdf');
    expect(scan.status).toBe(201);

    const people = await prisma.employee.findMany({
      where: { id: { in: [world.emp['1001'], world.emp['1003'], world.emp['1004']].map(String) } },
    });
    const secrets = people.flatMap((p) => [p.idNumber, p.firstName, p.lastName, p.email ?? '']);
    const audits = await prisma.auditLog.findMany({
      where: {
        action: {
          in: ['assignment.manual_send', 'assignment.printed', 'assignment.signed_manual'],
        },
      },
    });
    expect(audits).toHaveLength(3);
    const haystack = {
      logs: logLines.join('\n'),
      audits: JSON.stringify(audits.map(({ details }) => details)),
      jobs: JSON.stringify(await jobsOf(prisma, INVITATION_QUEUE.name)),
    };
    for (const secret of secrets.filter((value) => value !== '')) {
      for (const [where, text] of Object.entries(haystack)) {
        expect(text, `${where} holds personal data`).not.toContain(secret);
      }
    }
    expect(logLines.length).toBeGreaterThan(0);
  });
});
