import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { httpServer } from './app.js';
import type { RoundsWorld } from './rounds.js';
import { signAs, type SigningPerson, type SigningRound, signingRound } from './signing.js';
import { clearQueueJobs } from './worker.js';

/**
 * A signing round (the 3.13 contract, whose "nickname" box needs approval) in which these
 * employees signed through their links with `validSubmit()`: every row is "waiting for
 * approval". The signed-copy jobs are cleared.
 */
export async function waitingRound(
  app: INestApplication,
  prisma: PrismaService,
  world: RoundsWorld,
  numbers: string[],
): Promise<SigningRound> {
  const round = await signingRound(app, prisma, world, numbers);
  for (const number of numbers) {
    const signed = await signAs(app, personOf(round, number));
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
  }
  await clearQueueJobs(prisma);
  return round;
}

export function personOf(round: SigningRound, number: string): SigningPerson {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
}

/** A GET with the cookie (`null` = signed out). */
export function getAs(app: INestApplication, path: string, cookie: string | null) {
  const req = request(httpServer(app)).get(path);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

/** POST /api/assignments/:id/<action> (`null` = signed out). */
export function postApproval(
  app: INestApplication,
  assignmentId: string,
  action: 'approve' | 'return' | 'send-again',
  cookie: string | null,
  body?: object,
) {
  const req = request(httpServer(app)).post(`/api/assignments/${assignmentId}/${action}`);
  if (cookie) req.set('Cookie', cookie);
  return body ? req.send(body) : req;
}

/** Returns the row for correction and expects 200. */
export async function returnRow(
  app: INestApplication,
  world: RoundsWorld,
  assignmentId: string,
  note = 'יש לתקן את השם לתעודה',
): Promise<void> {
  const response = await postApproval(app, assignmentId, 'return', world.managerCookie, { note });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}
