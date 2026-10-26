import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { INVITATION_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { getAs, personOf, postApproval, waitingRound } from '../setup/approvals.js';
import { createTestApp } from '../setup/app.js';
import { jobsOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import type { SigningRound } from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * Approvals (3.16 part B2) keep personal data out of logs, audit rows and job data: the list,
 * the answers, approve, return and send-again are run, then everything is searched for the
 * return note, the answers, the addresses, the names and the ID numbers. Made-up employees only.
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
  round = await waitingRound(app, prisma, world, ['1001', '1002']);
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

describe('no note, answer, address, name or ID number leaves the approvals', () => {
  it('in logs, audit rows or job data', async () => {
    const note = 'הערה-סודית-לבדיקה';
    const idOf = (number: string) => personOf(round, number).assignmentId;
    const cookie = world.managerCookie;

    expect((await getAs(app, '/api/approvals', world.officerCookie)).status).toBe(200);
    expect((await postApproval(app, idOf('1002'), 'approve', cookie)).status).toBe(200);
    expect((await postApproval(app, idOf('1001'), 'return', cookie, { note })).status).toBe(200);
    const viewed = await getAs(app, `/api/assignments/${idOf('1001')}/responses`, cookie);
    expect(viewed.status).toBe(200);
    // The note is in the answer for staff, nowhere else.
    expect((viewed.body as { returnNote: string }).returnNote).toBe(note);
    expect(
      (await getAs(app, `/api/assignments/${idOf('1001')}/responses`, world.officerCookie)).status,
    ).toBe(200);
    expect((await postApproval(app, idOf('1001'), 'send-again', cookie)).status).toBe(201);

    const people = await prisma.employee.findMany({
      where: { id: { in: [world.emp['1001'], world.emp['1002']].map(String) } },
    });
    const secrets = [
      note,
      'דנה כהן',
      'dana.new@example.com',
      ...people.flatMap((p) => [p.idNumber, p.firstName, p.lastName, p.email ?? '']),
    ];
    const audits = await prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            'assignment.responses_viewed',
            'assignment.approved',
            'assignment.returned',
            'assignment.sent_again',
            'round.created',
            'round.sent',
          ],
        },
      },
    });
    expect(audits.filter(({ action }) => action.startsWith('assignment.'))).toHaveLength(5);
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
    expect(logLines.some((line) => line.includes('correction round'))).toBe(true);
  });
});
