import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { httpServer } from './app.js';
import { type SentRound, sentRoundOf } from './round-actions.js';
import type { RoundsWorld } from './rounds.js';

/**
 * A sent round (3.16 tests) with one row of each manual-handling kind, made-up employees only:
 * 1001 had no email at the send (`no_email`), 1002 had no address (`missing_data`, the address
 * is required), 1003 got the document (`sent`), 1004's invitation bounced (`invalid_email`).
 */
export async function manualRound(
  app: INestApplication,
  prisma: PrismaService,
  world: RoundsWorld,
): Promise<SentRound> {
  await prisma.employee.update({
    where: { id: world.emp['1001'] },
    data: { email: null, emailStatus: 'missing' },
  });
  await prisma.employee.update({
    where: { id: world.emp['1002'] },
    data: { address: null, city: null },
  });
  const round = await sentRoundOf(app, prisma, world, ['1001', '1002', '1003', '1004']);
  const bounced = round.assignment['1004'] ?? '';
  await prisma.emailMessage.updateMany({
    where: { assignmentId: bounced },
    data: { status: 'bounced', error: 'BOUNCED' },
  });
  await prisma.assignment.update({ where: { id: bounced }, data: { status: 'invalid_email' } });
  await prisma.employee.update({
    where: { id: world.emp['1004'] },
    data: { emailStatus: 'bounced' },
  });
  return round;
}

/** GET /api/manual-handling with a query string; `cookie: null` = signed out. */
export function getList(app: INestApplication, query: string, cookie: string | null) {
  const req = request(httpServer(app)).get(`/api/manual-handling${query}`);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

/** POST a JSON body to a manual-handling route (`search`, `send`). */
export function postManual(
  app: INestApplication,
  path: 'search' | 'send',
  body: object,
  cookie: string | null,
) {
  const req = request(httpServer(app)).post(`/api/manual-handling/${path}`).send(body);
  if (cookie) req.set('Cookie', cookie);
  return req;
}
