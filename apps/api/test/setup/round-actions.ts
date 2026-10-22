import { createHash, randomUUID } from 'node:crypto';
import type { ApiError } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { QUEUE_SCHEMA } from '../../src/common/queue/queue.definitions.js';
import { httpServer } from './app.js';
import { createDraft, createTemplate, type RoundsWorld, sendRound } from './rounds.js';
import { clearQueueJobs } from './worker.js';

/** Two days ago: older than both reminder waits (1 hour, 24 hours). */
export const TWO_DAYS_AGO = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

/** A sent round as it is once the worker sent everything, two days ago. */
export interface SentRound {
  roundId: string;
  templateId: string;
  /** Assignment id by seed employee number. */
  assignment: Record<string, string>;
}

/**
 * A round of these seed employees, created and sent through the API; then every invitation is
 * settled as sent two days ago (a token hash, no queued job left), as the worker would have.
 */
export async function sentRoundOf(
  app: INestApplication,
  prisma: PrismaService,
  world: RoundsWorld,
  numbers: string[],
): Promise<SentRound> {
  const templateId = await createTemplate(app, world.managerCookie, 'הצהרה', [world.dept[15]]);
  const draft = await createDraft(
    app,
    world.managerCookie,
    templateId,
    numbers.map((n) => world.emp[n] ?? ''),
  );
  await sendRound(app, world.managerCookie, draft.id);
  await clearQueueJobs(prisma);
  const at = TWO_DAYS_AGO();
  const invites = await prisma.emailMessage.findMany({
    where: { assignment: { roundId: draft.id } },
  });
  for (const invite of invites) {
    await prisma.emailMessage.update({
      where: { id: invite.id },
      data: { status: 'sent', tokenHash: tokenHash(), sentAt: at, createdAt: at },
    });
  }
  await prisma.assignment.updateMany({
    where: { roundId: draft.id, status: 'pending' },
    data: { status: 'sent', sentAt: at },
  });
  await prisma.round.update({ where: { id: draft.id }, data: { status: 'active' } });
  const rows = await prisma.assignment.findMany({
    where: { roundId: draft.id },
    select: { id: true, employee: { select: { employeeNumber: true } } },
  });
  return {
    roundId: draft.id,
    templateId,
    assignment: Object.fromEntries(rows.map((row) => [row.employee.employeeNumber, row.id])),
  };
}

export const tokenHash = () => createHash('sha256').update(randomUUID()).digest('hex');

/** POST an action with no body; `cookie: null` = signed out. */
export function postAction(app: INestApplication, path: string, cookie: string | null) {
  const req = request(httpServer(app)).post(path);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

export const errorOf = (response: request.Response) => (response.body as ApiError).error;

/** The pg-boss jobs of a queue (data only). */
export async function jobsOf(
  prisma: PrismaService,
  queueName: string,
): Promise<{ data: unknown; singletonKey: string | null }[]> {
  return prisma.$queryRawUnsafe(
    `SELECT data, singleton_key AS "singletonKey" FROM "${QUEUE_SCHEMA}".job WHERE name = $1`,
    queueName,
  );
}
