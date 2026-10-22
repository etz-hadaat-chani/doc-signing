import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  errorOf,
  signCookieOf,
  type SigningPerson,
  type SigningRound,
  signingRound,
  signServer,
  validSubmit,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * Per-IP limits (3.13, NFR-SEC-3) with lowered env values, behind one proxy (TRUST_PROXY_HOPS=1),
 * so each test picks the client IP with X-Forwarded-For.
 */

const ENV = {
  TRUST_PROXY_HOPS: '1',
  SIGN_RATE_LIMIT_VERIFY_WRONG: '30',
  SIGN_RATE_LIMIT_STATE: '200',
};

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [name, value] of Object.entries(ENV)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, [
    '1001',
    '1002',
    '1003',
    '1004',
    '1005',
    '1006',
    '1007',
  ]);
});

afterAll(async () => {
  await app.close();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const person = (number: string): SigningPerson => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};
const verifyFrom = (ip: string, who: SigningPerson, idNumber: string) =>
  signServer(app)
    .post(`/api/sign/${who.token}/verify`)
    .set('X-Forwarded-For', ip)
    .send({ idNumber });

describe('the per-IP limits', () => {
  it('wrong ID numbers across different links: the limit, then 429 even for the right one', async () => {
    const ip = '10.1.1.1';
    const numbers = ['1001', '1002', '1003', '1004', '1005', '1006'];
    for (const number of numbers) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const response = await verifyFrom(ip, person(number), '039337423');
        expect([401, 423]).toContain(response.status);
      }
    }
    const blocked = await verifyFrom(ip, person('1007'), person('1007').idNumber);
    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).code).toBe('SIGN_TOO_MANY_REQUESTS');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(errorOf(blocked).details).toEqual({ retryAfter });
    // Refused before comparing: her link is untouched.
    const row = await prisma.assignment.findUniqueOrThrow({
      where: { id: person('1007').assignmentId },
    });
    expect(row.failedAttempts).toBe(0);
    expect(row.status).toBe('sent');

    const logged = await prisma.auditLog.findMany({ where: { action: 'sign.rate_limited' } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ ip: ip, details: { scope: 'verify_wrong', limit: 30 } });

    // Another IP is not blocked.
    const other = await verifyFrom('10.1.1.2', person('1007'), person('1007').idNumber);
    expect(other.status).toBe(200);
  });

  it('a scan of made-up links counts too: after the limit even a real link gets 429', async () => {
    const ip = '10.2.2.2';
    for (let request = 1; request <= 200; request++) {
      const response = await signServer(app)
        .get(`/api/sign/${randomBytes(32).toString('base64url')}`)
        .set('X-Forwarded-For', ip);
      expect(response.status).toBe(404);
    }
    const blocked = await signServer(app)
      .get(`/api/sign/${person('1001').token}`)
      .set('X-Forwarded-For', ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['referrer-policy']).toBe('no-referrer');
    expect(blocked.headers['x-frame-options']).toBe('DENY');
    const other = await signServer(app)
      .get(`/api/sign/${person('1001').token}`)
      .set('X-Forwarded-For', '10.2.2.3');
    expect(other.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'sign.rate_limited' } })).toBe(1);
  });

  it('signer_ip is the client behind one proxy; a forged first hop is ignored', async () => {
    const verified = await verifyFrom('6.6.6.6, 10.3.3.3', person('1001'), person('1001').idNumber);
    expect(verified.status).toBe(200);
    const signed = await signServer(app)
      .post(`/api/sign/${person('1001').token}/submit`)
      .set('Cookie', signCookieOf(verified))
      .set('X-Forwarded-For', '10.3.3.3')
      .send(validSubmit());
    expect(signed.status).toBe(201);
    const row = await prisma.assignment.findUniqueOrThrow({
      where: { id: person('1001').assignmentId },
    });
    expect(row.signerIp).toBe('10.3.3.3');
    const session = await prisma.auditLog.findFirstOrThrow({ where: { action: 'sign.verified' } });
    expect(session.ip).toBe('10.3.3.3');
  });
});
