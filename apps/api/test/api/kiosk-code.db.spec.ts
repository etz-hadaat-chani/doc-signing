import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { kioskServer, openKioskShort } from '../setup/kiosk.js';
import { errorOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { type SigningRound, signingRound } from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * The short code typed on the office computer (5.7, FR-MAN-4): `POST /api/kiosk/code` trades it
 * once for the long kiosk code. One use, 10 minutes on the database clock, a new one ends the
 * old one; wrong codes are limited per IP and from all IPs together, correct ones only by a
 * loose per-IP cap (the office computers may share one public IP). The code is never in a log,
 * an audit row or an error answer. Behind one proxy, so each test picks the IP.
 */

const ENV = { TRUST_PROXY_HOPS: '1', SIGN_RATE_LIMIT_KIOSK_CODE_WRONG: '20' };

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;
const saved: Record<string, string | undefined> = {};
const logLines: string[] = [];

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
  round = await signingRound(app, prisma, world, ['1001', '1002']);
  vi.restoreAllMocks();
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
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const assignmentOf = (number: string) => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found.assignmentId;
};
const open = (number = '1001') => openKioskShort(app, assignmentOf(number), world.managerCookie);
const enter = (code: unknown, ip = '10.7.0.1') =>
  kioskServer(app).post('/api/kiosk/code').set('X-Forwarded-For', ip).send({ code });
const stateOf = (code: string) => kioskServer(app).post('/api/kiosk/state').send({ code });
const codeOf = (response: { body: unknown }) => (response.body as { code: string }).code;

/** A wrong code of the right shape (never one that is waiting). */
let wrongSeq = 0;
const wrongCode = () => `WRNG${String(2222 + (wrongSeq += 1)).replace(/[01]/g, '9')}`.slice(0, 8);

describe('POST /api/kiosk/code', () => {
  it('trades the short code once for the long code, which then opens the ID check', async () => {
    const opened = await open();
    // Typed in lower case, with the hyphen and spaces of the dialog: the same code.
    const typed = ` ${opened.shortCode.slice(0, 4).toLowerCase()}-${opened.shortCode.slice(4)} `;
    const entered = await enter(typed);
    expect(entered.status).toBe(200);
    expect(Object.keys(entered.body as object)).toEqual(['code']);
    expect(codeOf(entered)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(entered.headers['cache-control']).toContain('no-store');
    expect((await stateOf(codeOf(entered))).body).toMatchObject({ state: 'valid' });

    const again = await enter(opened.shortCode);
    expect(again.status).toBe(404);
    expect(errorOf(again).code).toBe('KIOSK_CODE_NOT_FOUND');

    const session = await prisma.kioskSession.findFirstOrThrow({ where: { endedAt: null } });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'kiosk.code_entered' },
    });
    expect(audit).toMatchObject({
      actorType: 'employee',
      entityType: 'assignment',
      entityId: assignmentOf('1001'),
      ip: '10.7.0.1',
    });
    expect(audit.details).toEqual({ roundId: round.roundId, kioskSessionId: session.id });
  });

  it('works 10 minutes on the database clock; the ID step then gets its own 10 minutes', async () => {
    const late = await open();
    await prisma.$executeRaw`
      UPDATE kiosk_sessions SET expires_at = now() + interval '30 seconds' WHERE ended_at IS NULL`;
    expect((await enter(late.shortCode)).status).toBe(200);
    const [row] = await prisma.$queryRaw<{ minutes: number }[]>`
      SELECT extract(epoch FROM expires_at - now()) / 60 AS minutes
      FROM kiosk_sessions WHERE ended_at IS NULL`;
    expect(Number(row?.minutes)).toBeGreaterThan(9.9);

    const old = await open();
    await prisma.$executeRaw`
      UPDATE kiosk_sessions SET expires_at = now() - interval '1 second' WHERE ended_at IS NULL`;
    const refused = await enter(old.shortCode);
    expect(refused.status).toBe(404);
    expect(errorOf(refused).code).toBe('KIOSK_CODE_NOT_FOUND');
  });

  it('a new code ends the earlier one, typed or not', async () => {
    const first = await open();
    const second = await open();
    expect((await enter(first.shortCode)).status).toBe(404);
    const entered = await enter(second.shortCode);
    expect(entered.status).toBe(200);
    await open();
    expect((await stateOf(codeOf(entered))).status).toBe(404);
    // Another employee's code is untouched.
    const other = await open('1002');
    expect((await enter(other.shortCode)).status).toBe(200);
  });

  it('15 correct codes from one IP pass (a busy office); 11 wrong ones from one IP → 429', async () => {
    const office = '10.7.1.1';
    for (let i = 0; i < 15; i += 1) {
      const opened = await open(i % 2 === 0 ? '1001' : '1002');
      expect((await enter(opened.shortCode, office)).status, `correct ${String(i)}`).toBe(200);
    }
    const guesser = '10.7.2.2';
    for (let i = 0; i < 10; i += 1) {
      expect((await enter(wrongCode(), guesser)).status, `wrong ${String(i)}`).toBe(404);
    }
    const eleventh = await enter(wrongCode(), guesser);
    expect(eleventh.status).toBe(429);
    expect(errorOf(eleventh).code).toBe('SIGN_TOO_MANY_REQUESTS');
    // Even the right code from that IP waits; the office's IP still works.
    const opened = await open();
    expect((await enter(opened.shortCode, guesser)).status).toBe(429);
    expect((await enter(opened.shortCode, office)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'kiosk.code_failed' } })).toBe(10);
  });

  it('wrong codes from all IPs together reach the global limit', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await enter(wrongCode(), `10.8.0.${String(i + 1)}`)).status).toBe(404);
    }
    const opened = await open();
    const blocked = await enter(opened.shortCode, '10.8.1.1');
    expect(blocked.status).toBe(429);
    const limited = await prisma.auditLog.findMany({ where: { action: 'sign.rate_limited' } });
    expect(limited.map(({ details }) => details)).toContainEqual({
      scope: 'kiosk_code_wrong',
      limit: 20,
    });
  });

  it('no code in logs, audit rows or any answer: correct, wrong and badly shaped', async () => {
    const opened = await open();
    const wrong = wrongCode();
    const shapes = ['ABC', 'ABCDEFGHJKMNP', '!!@@##$$', 'O0O0I1I1', `QZX${'Q'.repeat(98)}`];
    const answers = [
      await enter(opened.shortCode),
      await enter(wrong),
      ...(await Promise.all(shapes.map((shape) => enter(shape)))),
      await enter(12345678),
    ];
    const longCode = codeOf(answers[0] ?? { body: {} });
    expect(answers.map(({ status }) => status)).toEqual([200, 404, 404, 404, 404, 404, 400, 400]);
    expect(errorOf(answers[6] ?? ({} as never)).code).toBe('VALIDATION_FAILED');

    const audits = await prisma.auditLog.findMany();
    const haystacks = {
      logs: logLines.join('\n'),
      audit: JSON.stringify(audits, (_key, value: unknown) =>
        typeof value === 'bigint' ? String(value) : value,
      ),
      errors: JSON.stringify(answers.slice(1).map(({ body }) => body as unknown)),
    };
    const secrets = [opened.shortCode, longCode, wrong, ...shapes.slice(1), '12345678'];
    for (const [where, text] of Object.entries(haystacks)) {
      for (const secret of secrets) {
        expect(text.includes(secret), `${where} holds a code`).toBe(false);
      }
      expect(text.toUpperCase().includes(opened.shortCode), `${where} (any case)`).toBe(false);
    }
    // One failed row per wrong or badly shaped code (not the 400s), with only the IP.
    const failed = audits.filter(({ action }) => action === 'kiosk.code_failed');
    expect(failed).toHaveLength(5);
    expect(failed.every(({ details, entityId }) => entityId === null && details !== null)).toBe(
      true,
    );
    expect(failed.map(({ details }) => details)).toEqual(Array(5).fill({}));
  });
});
