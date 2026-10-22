import { randomUUID } from 'node:crypto';
import { templateItemSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { testPdf } from '../fixtures/pdf.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

/**
 * Every answer of the API carries `Cache-Control: no-store` and `nosniff`, and never
 * `X-Powered-By` (configureApp): JSON lists, errors (from the filter and Nest's own 404) and files.
 */

const seedPassword = 'test-seed-password';

let app: INestApplication;
let managerCookie: string;
let departmentId: string;

beforeAll(async () => {
  app = await createTestApp();
  const prisma = app.get(PrismaService);
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
  departmentId = (await prisma.department.findFirstOrThrow()).id;
  const login = await server()
    .post('/api/auth/login')
    .send({ email: 'manager@doc-signing.local', password: seedPassword });
  expect(login.status).toBe(200);
  const lines = login.headers['set-cookie'] as unknown as string[];
  managerCookie = (lines.find((value) => value.startsWith('sid=')) ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await app.close();
});

const server = () => request(httpServer(app));

function expectSecurityHeaders(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['x-powered-by']).toBeUndefined();
}

describe('security headers on every answer', () => {
  it('a JSON list', async () => {
    const response = await server().get('/api/rounds').set('Cookie', managerCookie);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expectSecurityHeaders(response);
  });

  it('error answers: 404 from a route, 401 signed out, 404 of an unknown path', async () => {
    const notFound = await server().get(`/api/rounds/${randomUUID()}`).set('Cookie', managerCookie);
    expect(notFound.status).toBe(404);
    expectSecurityHeaders(notFound);

    const signedOut = await server().get('/api/rounds');
    expect(signedOut.status).toBe(401);
    expectSecurityHeaders(signedOut);

    const noRoute = await server().get('/api/no-such-route').set('Cookie', managerCookie);
    expect(noRoute.status).toBe(404);
    expectSecurityHeaders(noRoute);
  });

  it('signing routes (3.13): no referrer and no framing, on errors too; not on other routes', async () => {
    const token = 'A'.repeat(43);
    const answers = [
      await server().get(`/api/sign/${token}`),
      await server().post(`/api/sign/${token}/verify`).send({ idNumber: '012345674' }),
      await server().get(`/api/sign/${token}/document`),
      await server().get('/api/sign/no/such/route'),
      await server()
        .post(`/api/sign/${token}/submit`)
        .set('Content-Type', 'application/json')
        .send('{"broken'),
    ];
    expect(answers.map(({ status }) => status)).toEqual([404, 404, 404, 404, 400]);
    for (const response of answers) {
      expectSecurityHeaders(response);
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    }
    const other = await server().get('/api/rounds').set('Cookie', managerCookie);
    expect(other.headers['x-frame-options']).toBeUndefined();
  });

  it('the PDF preview', async () => {
    const created = await server()
      .post('/api/templates')
      .set('Cookie', managerCookie)
      .field('name', 'מסמך לבדיקה')
      .field('departmentIds', departmentId)
      .attach('file', await testPdf(), 'מסמך.pdf');
    expect(created.status).toBe(201);
    const { id } = templateItemSchema.parse(created.body);

    const response = await server()
      .get(`/api/templates/${id}/preview`)
      .set('Cookie', managerCookie)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expectSecurityHeaders(response);
  });
});
