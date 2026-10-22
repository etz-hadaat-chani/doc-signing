import { SIGN_RATE_LIMITS } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../src/common/config/config.schema.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { freshEmail, type RoundsWorld, SEND_FIELDS, seedRoundsWorld } from '../setup/rounds.js';
import {
  type SigningPerson,
  signingRound,
  signServer,
  signaturePng,
  verifiedCookie,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';
import { asDataUrl } from '../fixtures/png.js';

/**
 * Many employees behind one filter IP (PRD §2: NetFree, Etrog, Nativ, Rimon): with the default
 * limits, 200 employees each open, mistype, check, read and sign from the same IP within one
 * 15-minute window, and none is blocked (3.13). Default limits, no proxy (every request is
 * 127.0.0.1).
 */

const EMPLOYEES = 200;
/** Requests in flight at once (employees signing at the same time). */
const AT_ONCE = 8;

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

/** A valid Israeli ID number (check digit) made from n. */
function idNumberOf(n: number): string {
  const body = String(30_000_000 + n).padStart(8, '0');
  const sum = [...body].reduce((total, char, i) => {
    const product = Number(char) * ((i % 2) + 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return `${body}${String((10 - (sum % 10)) % 10)}`;
}

/** 200 made-up employees in department 15, each with an address and a valid email. */
async function addEmployees(): Promise<string[]> {
  const numbers: string[] = [];
  for (let n = 1; n <= EMPLOYEES; n++) {
    const employeeNumber = String(50_000 + n);
    const employee = await prisma.employee.create({
      data: {
        employeeNumber,
        idNumber: idNumberOf(n),
        firstName: 'עובדת',
        lastName: `מספר ${String(n)}`,
        departmentId: world.dept[15],
        email: freshEmail(`shared-${String(n)}`),
        emailStatus: 'valid',
        address: 'הרב קוק 12',
        city: 'ירושלים',
        isActive: true,
      },
    });
    world.emp[employeeNumber] = employee.id;
    numbers.push(employeeNumber);
  }
  return numbers;
}

/** One employee's whole visit: state, a typo, the ID, the document, the form, the signature. */
async function visit(who: SigningPerson): Promise<number[]> {
  const base = `/api/sign/${who.token}`;
  const statuses: number[] = [];
  statuses.push((await signServer(app).get(base)).status);
  const typo = await signServer(app)
    .post(`${base}/verify`)
    .send({ idNumber: idNumberOf(999) });
  statuses.push(typo.status === 401 ? 200 : typo.status);
  const cookie = await verifiedCookie(app, who);
  statuses.push((await signServer(app).get(`${base}/document`).set('Cookie', cookie)).status);
  statuses.push((await signServer(app).get(`${base}/form`).set('Cookie', cookie)).status);
  const signed = await signServer(app)
    .post(`${base}/submit`)
    .set('Cookie', cookie)
    .send({
      signatureImage: asDataUrl(signaturePng()),
      acknowledged: true,
      emailChoice: 'office',
    });
  statuses.push(signed.status === 201 ? 200 : signed.status);
  return statuses;
}

describe('200 employees from one IP in one window', () => {
  it('are never blocked by the default limits', { timeout: 600_000 }, async () => {
    // The defaults are in force (no env override in this file).
    const limits = app.get(AppConfig).signRateLimits;
    expect(limits.verify_wrong).toBe(SIGN_RATE_LIMITS.verify_wrong.default);
    expect(limits.all).toBe(SIGN_RATE_LIMITS.all.default);

    const numbers = await addEmployees();
    const round = await signingRound(app, prisma, world, numbers, SEND_FIELDS);
    const people = Object.values(round.people);
    expect(people).toHaveLength(EMPLOYEES);

    const started = Date.now();
    const statuses: number[] = [];
    for (let start = 0; start < people.length; start += AT_ONCE) {
      const batch = people.slice(start, start + AT_ONCE);
      for (const result of await Promise.all(batch.map((who) => visit(who)))) {
        statuses.push(...result);
      }
    }
    const minutes = (Date.now() - started) / 60_000;
    expect(minutes).toBeLessThan(15);

    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    expect(
      await prisma.assignment.count({ where: { roundId: round.roundId, status: 'signed' } }),
    ).toBe(EMPLOYEES);
    expect(await prisma.auditLog.count({ where: { action: 'sign.rate_limited' } })).toBe(0);
  });
});
