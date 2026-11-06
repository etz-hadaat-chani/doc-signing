import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { AppConfig } from '../../src/common/config/config.schema.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';
import { postNotice } from '../setup/webhooks.js';

/**
 * CSRF (7.2, Fetch Metadata + Origin): a change (POST, PATCH…) sent by a browser page of another
 * origin is refused with 403 `CSRF_REFUSED` before its body is read or any route runs; our own
 * pages (same-origin), the exact app Origin and non-browser clients pass; reads are never
 * checked; the email webhook is exempt. Made-up data only.
 */

const seedPassword = 'test-seed-password';
const manager = { email: 'manager@doc-signing.local', password: seedPassword };
const token = 'A'.repeat(43);

let app: INestApplication;
let prisma: PrismaService;
let appOrigin: string;
let managerCookie: string;
let employeeId: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
  appOrigin = new URL(app.get(AppConfig).email.publicUrl).origin;
  employeeId = (await prisma.employee.findFirstOrThrow()).id;
  const login = await server().post('/api/auth/login').send(manager);
  expect(login.status).toBe(200);
  managerCookie = sessionCookie(login) ?? '';
});

afterAll(async () => {
  await app.close();
});

const server = () => request(httpServer(app));

function sessionCookie(response: request.Response): string | undefined {
  const lines = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return lines.find((line) => line.startsWith('sid='))?.split(';')[0];
}

/** What a browser page of another origin sends: each must be refused. */
const FOREIGN: [string, Record<string, string>][] = [
  ['Sec-Fetch-Site: cross-site', { 'Sec-Fetch-Site': 'cross-site' }],
  ['Sec-Fetch-Site: same-site (another subdomain or port)', { 'Sec-Fetch-Site': 'same-site' }],
  ['Sec-Fetch-Site: none', { 'Sec-Fetch-Site': 'none' }],
  ['Origin: null (sandboxed frame, file)', { Origin: 'null' }],
  ['Origin: another subdomain', { Origin: 'http://evil.localhost:5173' }],
  ['Origin: another port', { Origin: 'http://localhost:5174' }],
  ['Origin: another scheme', { Origin: 'https://localhost:5173' }],
];

/** Every kind of state-changing route: staff, login / logout, signing link, office kiosk. */
const CHANGES: { name: string; send: (headers: Record<string, string>) => request.Test }[] = [
  {
    name: 'login',
    send: (headers) => server().post('/api/auth/login').set(headers).send(manager),
  },
  {
    name: 'logout',
    send: (headers) => server().post('/api/auth/logout').set('Cookie', managerCookie).set(headers),
  },
  {
    name: 'staff POST (employee search)',
    send: (headers) =>
      server()
        .post('/api/employees/search')
        .set('Cookie', managerCookie)
        .set(headers)
        .send({ q: 'בדיקה' }),
  },
  {
    name: 'staff PATCH (employee card)',
    send: (headers) =>
      server()
        .patch(`/api/employees/${employeeId}`)
        .set('Cookie', managerCookie)
        .set(headers)
        .send({ firstName: 'שונה' }),
  },
  {
    name: 'signing verify',
    send: (headers) =>
      server().post(`/api/sign/${token}/verify`).set(headers).send({ idNumber: '012345674' }),
  },
  {
    name: 'signing submit',
    send: (headers) => server().post(`/api/sign/${token}/submit`).set(headers).send({}),
  },
  {
    name: 'signing preview',
    send: (headers) => server().post(`/api/sign/${token}/preview`).set(headers).send({}),
  },
  {
    name: 'signing fit',
    send: (headers) => server().post(`/api/sign/${token}/fit`).set(headers).send({}),
  },
  {
    name: 'kiosk code',
    send: (headers) => server().post('/api/kiosk/code').set(headers).send({ code: 'ABCD2345' }),
  },
  {
    name: 'kiosk verify',
    send: (headers) =>
      server().post('/api/kiosk/verify').set(headers).send({ idNumber: '012345674' }),
  },
  {
    name: 'kiosk submit',
    send: (headers) => server().post('/api/kiosk/submit').set(headers).send({}),
  },
  {
    name: 'kiosk preview',
    send: (headers) => server().post('/api/kiosk/preview').set(headers).send({}),
  },
];

function expectRefused(response: request.Response): void {
  expect(response.status).toBe(403);
  expect((response.body as { error: { code: string } }).error.code).toBe('CSRF_REFUSED');
  // Through the error filter, after the headers: a refusal carries them too.
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-security-policy']).toMatch(/frame-ancestors/);
}

describe('a change from another origin is refused', () => {
  for (const { name, send } of CHANGES) {
    it(name, async () => {
      for (const [, headers] of FOREIGN) {
        expectRefused(await send(headers));
      }
    });
  }

  it('nothing happens: no session from a refused login, no change, no audit row', async () => {
    const auditsBefore = await prisma.auditLog.count();
    const employeeBefore = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const login = await server()
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send(manager);
    expectRefused(login);
    expect(sessionCookie(login)).toBeUndefined();
    expectRefused(
      await server()
        .patch(`/api/employees/${employeeId}`)
        .set('Cookie', managerCookie)
        .set('Origin', 'http://evil.localhost:5173')
        .send({ firstName: 'שונה' }),
    );
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).toEqual(
      employeeBefore,
    );
    expect(await prisma.auditLog.count()).toBe(auditsBefore);
    // The session survived the refused logout above.
    const me = await server().get('/api/auth/me').set('Cookie', managerCookie);
    expect(me.status).toBe(200);
  });

  it('the body is never read: a body over the 100 KB JSON limit gets 403, not 413', async () => {
    const big = JSON.stringify({ q: 'x'.repeat(200 * 1024) });
    const send = (headers: Record<string, string>) =>
      server()
        .post('/api/employees/search')
        .set('Cookie', managerCookie)
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(big);
    expectRefused(await send({ 'Sec-Fetch-Site': 'cross-site' }));
    // The same body from our own page is read, and is too large.
    expect((await send({ 'Sec-Fetch-Site': 'same-origin' })).status).toBe(413);
  });
});

describe('our own pages and other clients pass', () => {
  it('Sec-Fetch-Site: same-origin (our pages, the Swagger page on its own port)', async () => {
    const login = await server()
      .post('/api/auth/login')
      .set({ 'Sec-Fetch-Site': 'same-origin', Origin: 'http://localhost:3000' })
      .send(manager);
    expect(login.status).toBe(200);
    expect(sessionCookie(login)).toBeDefined();
    const search = await server()
      .post('/api/employees/search')
      .set('Cookie', managerCookie)
      .set('Sec-Fetch-Site', 'same-origin')
      .send({});
    expect(search.status).toBe(200);
  });

  it('the app Origin exactly, without Sec-Fetch-Site', async () => {
    const search = await server()
      .post('/api/employees/search')
      .set('Cookie', managerCookie)
      .set('Origin', appOrigin)
      .send({});
    expect(search.status).toBe(200);
  });

  it('every route kind reaches its own checks when sent from our pages (no 403)', async () => {
    for (const { name, send } of CHANGES.filter((change) => change.name !== 'logout')) {
      const response = await send({ 'Sec-Fetch-Site': 'same-origin', Origin: appOrigin });
      expect([name, response.status]).not.toEqual([name, 403]);
    }
  });

  it('the 5 MB submit parser still reads a large body from our pages', async () => {
    const large = JSON.stringify({ signature: 'x'.repeat(1024 * 1024) });
    const response = await server()
      .post(`/api/sign/${token}/submit`)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Content-Type', 'application/json')
      .send(large);
    // Parsed (not 413 PAYLOAD_TOO_LARGE), then refused by the submit schema.
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('a client that is not a browser page (neither header) passes', async () => {
    const search = await server()
      .post('/api/employees/search')
      .set('Cookie', managerCookie)
      .send({});
    expect(search.status).toBe(200);
  });

  it('reads are never checked', async () => {
    const list = await server()
      .get('/api/employees')
      .set('Cookie', managerCookie)
      .set({ 'Sec-Fetch-Site': 'cross-site', Origin: 'http://evil.localhost:5173' });
    expect(list.status).toBe(200);
  });

  it('the email webhook is exempt (server to server, checked by its signature)', async () => {
    const response = await postNotice(app, {
      events: [{ type: 'delivery', messageId: '<unknown@example.test>' }],
    }).set({ 'Sec-Fetch-Site': 'cross-site', Origin: 'null' });
    expect(response.status).toBe(200);
  });
});
