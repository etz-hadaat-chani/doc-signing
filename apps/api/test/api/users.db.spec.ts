import type { ApiError, AuthUser, FieldError, Paged, StaffUser } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';
const manager = 'manager@doc-signing.local';
const officer = 'officer@doc-signing.local';
const unknownId = '00000000-0000-4000-8000-000000000000';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
});

afterAll(async () => {
  await app.close();
});

function login(email: string, password = seedPassword) {
  return request(httpServer(app)).post('/api/auth/login').send({ email, password });
}

/** Logs in and returns `sid=<token>` for a Cookie header. */
async function cookieFor(email: string, password = seedPassword): Promise<string> {
  const response = await login(email, password);
  expect(response.status).toBe(200);
  const lines = response.headers['set-cookie'] as unknown as string[];
  const line = lines.find((value) => value.startsWith('sid=')) ?? '';
  return line.split(';')[0] ?? '';
}

/** Typed views of a response body (supertest types it as any). */
const errorOf = (response: request.Response) => (response.body as ApiError).error;
const userOf = (response: request.Response) => response.body as StaffUser;
const pageOf = (response: request.Response) => response.body as Paged<StaffUser>;

function withCookie(req: request.Test, cookie?: string): request.Test {
  return cookie ? req.set('Cookie', cookie) : req;
}

function listUsers(cookie?: string, query = '') {
  return withCookie(request(httpServer(app)).get(`/api/users${query}`), cookie);
}

function createUser(body: object, cookie?: string) {
  return withCookie(request(httpServer(app)).post('/api/users'), cookie).send(body);
}

function updateUser(id: string, body: object, cookie?: string) {
  return withCookie(request(httpServer(app)).patch(`/api/users/${id}`), cookie).send(body);
}

function me(cookie: string) {
  return request(httpServer(app)).get('/api/auth/me').set('Cookie', cookie);
}

async function userId(email: string): Promise<string> {
  return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
}

function userAuditRows() {
  return prisma.auditLog.findMany({
    where: { action: { startsWith: 'user.' } },
    orderBy: { id: 'asc' },
  });
}

const newOfficer = {
  email: '  New.Officer@Example.COM ',
  fullName: 'קצין חדש',
  role: 'officer',
  password: 'officer password 1',
};

describe('access to /api/users', () => {
  const routes = [
    ['GET /api/users', () => request(httpServer(app)).get('/api/users')],
    ['POST /api/users', () => request(httpServer(app)).post('/api/users').send(newOfficer)],
    [
      'PATCH /api/users/:id',
      () => request(httpServer(app)).patch(`/api/users/${unknownId}`).send({ isActive: false }),
    ],
  ] as const;

  it.each(routes)('%s: signed out → 401', async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHORIZED');
  });

  it.each(routes)('%s: officer → 403', async (_name, call) => {
    const cookie = await cookieFor(officer);
    const response = await call().set('Cookie', cookie);
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('FORBIDDEN');
  });

  it('an officer can change nothing', async () => {
    const cookie = await cookieFor(officer);
    await createUser(newOfficer, cookie);
    await updateUser(await userId(manager), { isActive: false }, cookie);
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.user.findUniqueOrThrow({ where: { email: manager } })).toMatchObject({
      isActive: true,
    });
    expect(await userAuditRows()).toEqual([]);
  });
});

describe('GET /api/users', () => {
  it('lists users, paged, without password hashes', async () => {
    const response = await listUsers(await cookieFor(manager));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    expect(pageOf(response).items).toEqual(
      ['ממונה צפייה', 'מנהלת מערכת'].map(
        (fullName) => expect.objectContaining({ fullName, isActive: true }) as StaffUser,
      ),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/password|argon2/i);
  });

  it('pages stably by name, then id', async () => {
    const cookie = await cookieFor(manager);
    for (const n of [1, 2, 3]) {
      await createUser(
        { ...newOfficer, email: `same${n}@example.com`, fullName: 'אותו שם' },
        cookie,
      );
    }
    const sameName = await prisma.user.findMany({
      where: { fullName: 'אותו שם' },
      orderBy: { id: 'asc' },
    });

    const page1 = await listUsers(cookie, '?page=1&pageSize=2');
    const page2 = await listUsers(cookie, '?page=2&pageSize=2');

    expect(page1.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(page2.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    // "אותו שם" sorts first; the three share a name, so id decides.
    const ids = [...pageOf(page1).items, ...pageOf(page2).items].map((user) => user.id);
    expect(ids.slice(0, 3)).toEqual(sameName.map(({ id }) => id));
  });

  it('rejects a bad page size with 400', async () => {
    const response = await listUsers(await cookieFor(manager), '?pageSize=500');
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/users', () => {
  it('creates an officer who can then log in', async () => {
    const response = await createUser(newOfficer, await cookieFor(manager));

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String) as string,
      email: 'new.officer@example.com',
      fullName: 'קצין חדש',
      role: 'officer',
      isActive: true,
      lastLoginAt: null,
      createdAt: expect.any(String) as string,
    });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userOf(response).id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verify(stored.passwordHash, newOfficer.password)).toBe(true);

    const officerCookie = await cookieFor('new.officer@example.com', newOfficer.password);
    expect(((await me(officerCookie)).body as AuthUser).role).toBe('officer');
    expect((await listUsers(officerCookie)).status).toBe(403);
  });

  it('logs the creation without the password', async () => {
    const response = await createUser(newOfficer, await cookieFor(manager));

    const rows = await userAuditRows();
    expect(rows).toEqual([
      expect.objectContaining({
        actorType: 'user',
        userId: await userId(manager),
        action: 'user.created',
        entityType: 'user',
        entityId: userOf(response).id,
        details: { email: 'new.officer@example.com', fullName: 'קצין חדש', role: 'officer' },
      }),
    ]);
    expect(JSON.stringify(rows.map(({ details }) => details))).not.toContain(newOfficer.password);
  });

  it('refuses an existing email, in any capitals, with 409', async () => {
    const response = await createUser(
      { ...newOfficer, email: 'Officer@Doc-Signing.LOCAL' },
      await cookieFor(manager),
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'EMAIL_TAKEN', message: 'כתובת האימייל כבר רשומה במערכת' },
    });
    expect(await prisma.user.count()).toBe(2);
    expect(await userAuditRows()).toEqual([]);
  });

  it('refuses bad input with 400 and never echoes the password', async () => {
    const response = await createUser(
      { ...newOfficer, password: 'short1234', role: 'admin' },
      await cookieFor(manager),
    );

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    expect((errorOf(response).details?.fields as FieldError[]).map((f) => f.field).sort()).toEqual([
      'password',
      'role',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('short1234');
  });
});

describe('PATCH /api/users/:id', () => {
  it('gives 404 for an unknown user and 400 for a malformed id', async () => {
    const cookie = await cookieFor(manager);

    const unknown = await updateUser(unknownId, { isActive: false }, cookie);
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('NOT_FOUND');

    const malformed = await updateUser('not-a-uuid', { isActive: false }, cookie);
    expect(malformed.status).toBe(400);
  });

  it('refuses an email change and an empty body with 400', async () => {
    const cookie = await cookieFor(manager);
    const id = await userId(officer);
    expect((await updateUser(id, { email: 'x@example.com' }, cookie)).status).toBe(400);
    expect((await updateUser(id, {}, cookie)).status).toBe(400);
  });

  it('disabling a user ends their session and blocks login; enabling lets them back', async () => {
    const managerCookie = await cookieFor(manager);
    const officerCookie = await cookieFor(officer);
    const id = await userId(officer);

    const response = await updateUser(id, { isActive: false }, managerCookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id, isActive: false });

    expect((await me(officerCookie)).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
    expect((await login(officer)).status).toBe(401);

    expect((await updateUser(id, { isActive: true }, managerCookie)).status).toBe(200);
    expect((await login(officer)).status).toBe(200);

    expect((await userAuditRows()).map(({ action, details }) => [action, details])).toEqual([
      ['user.disabled', { sessionsEnded: 1 }],
      ['user.enabled', {}],
    ]);
  });

  it("resetting a password ends all the user's sessions", async () => {
    const managerCookie = await cookieFor(manager);
    const first = await cookieFor(officer);
    const second = await cookieFor(officer);
    const id = await userId(officer);
    const newPassword = 'a brand new password';

    const response = await updateUser(id, { password: newPassword }, managerCookie);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/password|argon2/i);

    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(401);
    expect((await login(officer)).status).toBe(401);
    expect((await login(officer, newPassword)).status).toBe(200);

    const rows = await userAuditRows();
    expect(rows.map(({ action, details }) => [action, details])).toEqual([
      ['user.password_reset', { sessionsEnded: 2 }],
    ]);
    expect(JSON.stringify(rows.map(({ details }) => details))).not.toContain(newPassword);
  });

  it('a manager resetting their own password keeps the current session only', async () => {
    const current = await cookieFor(manager);
    const other = await cookieFor(manager);

    const response = await updateUser(
      await userId(manager),
      { password: 'my new password' },
      current,
    );
    expect(response.status).toBe(200);
    expect((await me(current)).status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await userAuditRows())[0]?.details).toEqual({ sessionsEnded: 1 });
  });

  it('a role change applies on the next request; renames are logged', async () => {
    const managerCookie = await cookieFor(manager);
    const officerCookie = await cookieFor(officer);
    const id = await userId(officer);

    expect((await listUsers(officerCookie)).status).toBe(403);
    const response = await updateUser(id, { role: 'manager', fullName: 'שם חדש' }, managerCookie);
    expect(response.body).toMatchObject({ role: 'manager', fullName: 'שם חדש' });
    expect((await listUsers(officerCookie)).status).toBe(200);

    expect((await userAuditRows()).map(({ action, details }) => [action, details])).toEqual([
      ['user.renamed', { from: 'ממונה צפייה', to: 'שם חדש' }],
      ['user.role_changed', { from: 'officer', to: 'manager' }],
    ]);
  });

  it('a change to the same values logs nothing', async () => {
    const response = await updateUser(
      await userId(officer),
      { role: 'officer', isActive: true },
      await cookieFor(manager),
    );
    expect(response.status).toBe(200);
    expect(await userAuditRows()).toEqual([]);
  });

  it.each([
    ['disable themselves', { isActive: false }],
    ['make themselves an officer', { role: 'officer' }],
  ])('a manager cannot %s (409)', async (_name, body) => {
    const cookie = await cookieFor(manager);
    const response = await updateUser(await userId(manager), body, cookie);

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('CANNOT_CHANGE_OWN_ACCESS');
    expect(((await me(cookie)).body as AuthUser).role).toBe('manager');
    expect(await userAuditRows()).toEqual([]);
  });

  it('two managers disabling each other at once: one wins, the other gets 409, never 500', async () => {
    const managerCookie = await cookieFor(manager);
    const created = await createUser(
      { ...newOfficer, email: 'second.manager@example.com', role: 'manager' },
      managerCookie,
    );
    const secondCookie = await cookieFor('second.manager@example.com', newOfficer.password);
    const firstId = await userId(manager);
    const secondId = userOf(created).id;

    // Hold the managers' row locks so both requests are surely waiting on them together. The
    // pending requests are wrapped in an object: returning the promise itself would make the
    // transaction wait for requests that wait for its lock.
    const { both } = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM users WHERE role = 'manager' AND is_active ORDER BY id FOR UPDATE`;
        const pending = Promise.all([
          updateUser(secondId, { isActive: false }, managerCookie),
          updateUser(firstId, { isActive: false }, secondCookie),
        ]);
        await waitForLockWaiters(2);
        return { both: pending };
      },
      { timeout: 10_000 },
    );
    const results = await both;

    const statuses = results.map(({ status }) => status).sort();
    expect(statuses).toEqual([200, 409]);
    const refused = results.find(({ status }) => status === 409);
    expect(refused && errorOf(refused).code).toBe('LAST_ACTIVE_MANAGER');
    expect(await prisma.user.count({ where: { role: 'manager', isActive: true } })).toBe(1);
    expect((await userAuditRows()).filter(({ action }) => action === 'user.disabled')).toHaveLength(
      1,
    );
  });
});

describe('users table', () => {
  it('refuses an email with capitals (users_email_lowercase_check)', async () => {
    await expect(
      prisma.user.create({
        data: { email: 'Caps@Example.com', fullName: 'x', role: 'officer', passwordHash: 'x' },
      }),
    ).rejects.toThrow(/users_email_lowercase_check/);
  });
});

/** Waits until `count` database sessions are waiting on a row lock (max 5 s). */
async function waitForLockWaiters(count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((row?.waiting ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${count} sessions waiting on a lock`);
}
