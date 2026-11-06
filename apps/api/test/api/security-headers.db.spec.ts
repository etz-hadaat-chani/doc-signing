import { randomUUID } from 'node:crypto';
import { templateItemSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_CSP, SELF_FRAME_CSP, TAB_PDF_CSP } from '../../src/app.setup.js';
import { setupApiDocs } from '../../src/common/api-docs/api-docs.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { testPdf } from '../fixtures/pdf.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { manualRound } from '../setup/manual-handling.js';
import type { SentRound } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * The headers of every answer (configureApp, 7.2): Helmet's set, `no-store`, `nosniff`, no
 * `X-Powered-By`, and our CSP per kind of answer: JSON and errors (`API_CSP`), the signing routes,
 * and the routes the browser opens itself (a new tab, a hidden frame), which must still work.
 * Made-up data only.
 */

let app: INestApplication;
let world: RoundsWorld;
let round: SentRound;
let templateId: string;

beforeAll(async () => {
  app = await createTestApp({
    beforeInit: (nest) => setupApiDocs(nest, { nodeEnv: 'development' }),
  });
  const prisma = app.get(PrismaService);
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await manualRound(app, prisma, world);

  const created = await server()
    .post('/api/templates')
    .set('Cookie', world.managerCookie)
    .field('name', 'מסמך לבדיקה')
    .field('departmentIds', world.dept[15])
    .attach('file', await testPdf(), 'מסמך.pdf');
  expect(created.status).toBe(201);
  templateId = templateItemSchema.parse(created.body).id;

  // 1001 (no email) signed on paper: the ZIP and the document link then have a file.
  const scan = await server()
    .post(`/api/assignments/${idOf('1001')}/manual-sign`)
    .set('Cookie', world.managerCookie)
    .attach('file', await testPdf(), 'סריקה.pdf');
  expect(scan.status).toBe(201);
});

afterAll(async () => {
  await app.close();
});

const server = () => request(httpServer(app));
const idOf = (number: string) => round.assignment[number] ?? '';

/** A file answer read as bytes (supertest would try to parse it). */
function getFile(path: string) {
  return server()
    .get(path)
    .set('Cookie', world.managerCookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
}

function expectSecurityHeaders(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['x-powered-by']).toBeUndefined();
  // Helmet's set.
  expect(response.headers['strict-transport-security']).toBe('max-age=15552000');
  expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(response.headers['origin-agent-cluster']).toBe('?1');
  expect(response.headers['x-dns-prefetch-control']).toBe('off');
  expect(response.headers['x-download-options']).toBe('noopen');
  expect(response.headers['x-permitted-cross-domain-policies']).toBe('none');
  expect(response.headers['x-xss-protection']).toBe('0');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
}

/** Not shown in any frame, nothing loads inside it. */
function expectApiFrameRules(response: request.Response): void {
  expect(response.headers['x-frame-options']).toBe('DENY');
  expect(response.headers['content-security-policy']).toBe(API_CSP);
}

describe('security headers on every answer', () => {
  it('a JSON list', async () => {
    const response = await server().get('/api/rounds').set('Cookie', world.managerCookie);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expectSecurityHeaders(response);
    expectApiFrameRules(response);
  });

  it('error answers: 404 from a route, 401 signed out, 404 of an unknown path', async () => {
    const notFound = await server()
      .get(`/api/rounds/${randomUUID()}`)
      .set('Cookie', world.managerCookie);
    expect(notFound.status).toBe(404);
    const signedOut = await server().get('/api/rounds');
    expect(signedOut.status).toBe(401);
    const noRoute = await server().get('/api/no-such-route').set('Cookie', world.managerCookie);
    expect(noRoute.status).toBe(404);
    for (const response of [notFound, signedOut, noRoute]) {
      expectSecurityHeaders(response);
      expectApiFrameRules(response);
    }
  });

  it('signing routes (3.13): no referrer and no framing, on errors too', async () => {
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
      // The office kiosk (3.16) gets the same.
      await server().post('/api/kiosk/state').send({ code: token }),
      await server().get('/api/kiosk/document'),
    ];
    expect(answers.map(({ status }) => status)).toEqual([404, 404, 404, 404, 400, 404, 401]);
    for (const response of answers) {
      expectSecurityHeaders(response);
      expectApiFrameRules(response);
    }
  });

  it('the Swagger page outside production has no CSP (its own inline scripts), the rest stays', async () => {
    const response = await server().get('/api/docs');
    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toBeUndefined();
    expect(response.headers['x-frame-options']).toBe('DENY');
    expectSecurityHeaders(response);
  });
});

describe('routes the browser opens itself still work', () => {
  it('template preview (new tab): an inline PDF, framing refused', async () => {
    const response = await getFile(`/api/templates/${templateId}/preview`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toMatch(/^inline;/);
    expect((response.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expectSecurityHeaders(response);
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toBe(TAB_PDF_CSP);
    // A longer path under it is a JSON route: the API's own policy.
    const check = await server()
      .get(`/api/templates/${templateId}/preview/check`)
      .set('Cookie', world.managerCookie);
    expect(check.status).toBe(200);
    expectApiFrameRules(check);
  });

  it('print (new tab): an inline PDF, framing refused', async () => {
    const response = await getFile(`/api/assignments/${idOf('1003')}/print`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toMatch(/^inline;/);
    expectSecurityHeaders(response);
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toBe(TAB_PDF_CSP);
  });

  it('signed document (new tab): a redirect to the storage link', async () => {
    const response = await server()
      .get(`/api/assignments/${idOf('1001')}/document`)
      .set('Cookie', world.managerCookie)
      .redirects(0);
    expect(response.status).toBe(302);
    expect(response.headers.location).toMatch(/^https?:\/\//);
    expectSecurityHeaders(response);
    expectApiFrameRules(response);
  });

  it('Excel export and ZIP (hidden frame): files, and error answers frameable by our own pages', async () => {
    const answers = [
      await getFile(`/api/rounds/${round.roundId}/export`),
      await getFile(`/api/rounds/${round.roundId}/download`),
      // 409: no signed file in department 19; the frame must still be able to read it.
      await getFile(`/api/rounds/${round.roundId}/download?dept=${world.dept[19]}`),
    ];
    expect(answers.map(({ status }) => status)).toEqual([200, 200, 409]);
    expect(answers[0]?.headers['content-type']).toMatch(/spreadsheetml/);
    expect(answers[0]?.headers['content-disposition']).toMatch(/^attachment;/);
    expect(answers[1]?.headers['content-type']).toBe('application/zip');
    expect(answers[1]?.headers['content-disposition']).toMatch(/^attachment;/);
    expect(answers[2]?.headers['content-type']).toMatch(/^application\/json/);
    for (const response of answers) {
      expectSecurityHeaders(response);
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['content-security-policy']).toBe(SELF_FRAME_CSP);
    }
  });
});
