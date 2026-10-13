import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const password = 'test-seed-password';
const manager = 'manager@doc-signing.local';
const officer = 'officer@doc-signing.local';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password });
});

afterAll(async () => {
  await app.close();
});

function login(email: string, pass = password, cookie?: string) {
  const req = request(httpServer(app)).post('/api/auth/login');
  if (cookie) req.set('Cookie', cookie);
  return req.send({ email, password: pass });
}

/** The `sid` Set-Cookie line of a response. */
function sessionSetCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown;
  const lines = Array.isArray(header) ? (header as string[]) : [];
  const line = lines.find((value) => value.startsWith('sid='));
  if (!line) throw new Error('no sid cookie set');
  return line;
}

/** `sid=<token>`, ready for a Cookie header. */
function sessionCookie(response: request.Response): string {
  return sessionSetCookie(response).split(';')[0] ?? '';
}

function tokenOf(cookie: string): string {
  return cookie.slice('sid='.length);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function loginOk(email = manager): Promise<string> {
  const response = await login(email);
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

function me(cookie?: string) {
  const req = request(httpServer(app)).get('/api/auth/me');
  if (cookie) req.set('Cookie', cookie);
  return req;
}

const invalidCredentials = {
  error: { code: 'INVALID_CREDENTIALS', message: 'האימייל או הסיסמה שגויים' },
};

describe('POST /api/auth/login', () => {
  it('logs a seed user in with a secure session cookie', async () => {
    const response = await login(manager);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: expect.any(String) as string,
      email: manager,
      fullName: 'מנהלת מערכת',
      role: 'manager',
    });
    const setCookie = sessionSetCookie(response);
    const flags = setCookie.split(';').map((part) => part.trim().toLowerCase());
    expect(flags).toContain('httponly');
    expect(flags).toContain('secure');
    expect(flags).toContain('samesite=strict');
    expect(flags).toContain('path=/api');
    expect(flags.some((flag) => flag.startsWith('expires=') || flag.startsWith('max-age='))).toBe(
      false,
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { email: manager } });
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it('accepts the email in any case and with spaces', async () => {
    const response = await login('  MANAGER@Doc-Signing.local ');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: manager });
  });

  it('gives the same 401 for a wrong password, an unknown email and a disabled user', async () => {
    await prisma.user.update({ where: { email: officer }, data: { isActive: false } });

    const responses = [
      await login(manager, 'wrong-password'),
      await login('nobody@doc-signing.local'),
      await login(officer),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual(invalidCredentials);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(await prisma.session.count()).toBe(0);
  });

  it('refuses the 6th attempt in 15 minutes with 429, even with the right password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(manager, 'wrong-password')).status).toBe(401);
    }
    const sixth = await login(manager);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: 'יותר מדי ניסיונות. נא לנסות שוב מאוחר יותר' },
    });
    expect(sixth.headers['set-cookie']).toBeUndefined();

    // Another user's limit is separate.
    expect((await login(officer)).status).toBe(200);
  });

  it('counts unknown emails the same way', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('nobody@doc-signing.local')).status).toBe(401);
    }
    expect((await login('nobody@doc-signing.local')).status).toBe(429);
  });

  it('allows attempts again once they are older than 15 minutes', async () => {
    for (let i = 0; i < 5; i++) await login(manager, 'wrong-password');
    await prisma.loginAttempt.updateMany({
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    expect((await login(manager)).status).toBe(200);
  });

  it("clears the user's own attempts on success, and nobody else's", async () => {
    for (let i = 0; i < 4; i++) await login(manager, 'wrong-password');
    await login(officer, 'wrong-password');
    expect((await login(manager)).status).toBe(200);

    expect(await prisma.loginAttempt.count({ where: { email: manager } })).toBe(0);
    expect(await prisma.loginAttempt.count({ where: { email: officer } })).toBe(1);
  });

  it('answers 400 for an invalid body', async () => {
    const response = await request(httpServer(app))
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('starts a new session on every login and ends the one sent along', async () => {
    const first = await loginOk();
    const second = await loginOk();
    expect(second).not.toBe(first);
    expect(await prisma.session.count()).toBe(2);

    const third = sessionCookie(await login(manager, password, first));
    const hashes = (await prisma.session.findMany()).map(({ tokenHash }) => tokenHash);
    expect(hashes.sort()).toEqual([sha256(tokenOf(second)), sha256(tokenOf(third))].sort());
    expect((await me(first)).status).toBe(401);
  });

  it('never stores the raw token', async () => {
    const token = tokenOf(await loginOk());
    const [row] = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM sessions`;
    expect(row?.token_hash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    const response = await me(await loginOk(officer));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: officer, role: 'officer' });
  });

  it('answers 401 without a session or with an unknown one', async () => {
    for (const cookie of [undefined, 'sid=garbage', `sid=${'a'.repeat(43)}`]) {
      const response = await me(cookie);
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    }
  });

  it('refuses and deletes a session idle for over 30 minutes', async () => {
    const cookie = await loginOk();
    await prisma.session.updateMany({
      data: { lastUsedAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    expect((await me(cookie)).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('extends the idle limit on use', async () => {
    const cookie = await loginOk();
    const old = new Date(Date.now() - 20 * 60 * 1000);
    await prisma.session.updateMany({ data: { lastUsedAt: old } });
    expect((await me(cookie)).status).toBe(200);
    const session = await prisma.session.findFirstOrThrow();
    expect(session.lastUsedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it('refuses and deletes a session past its absolute limit, even if active', async () => {
    const cookie = await loginOk();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me(cookie)).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('sets the absolute limit 12 hours after login', async () => {
    const before = Date.now();
    await loginOk();
    const session = await prisma.session.findFirstOrThrow();
    const twelveHours = 12 * 60 * 60 * 1000;
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + twelveHours);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + twelveHours);
  });

  it('refuses a user disabled after login on the next request', async () => {
    const cookie = await loginOk();
    await prisma.user.update({ where: { email: manager }, data: { isActive: false } });
    expect((await me(cookie)).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const cookie = await loginOk();
    const response = await request(httpServer(app)).post('/api/auth/logout').set('Cookie', cookie);

    expect(response.status).toBe(204);
    expect(sessionSetCookie(response)).toMatch(/^sid=;/);
    expect(await prisma.session.count()).toBe(0);
    expect((await me(cookie)).status).toBe(401);
  });

  it('answers 401 without a session', async () => {
    const response = await request(httpServer(app)).post('/api/auth/logout');
    expect(response.status).toBe(401);
  });
});
