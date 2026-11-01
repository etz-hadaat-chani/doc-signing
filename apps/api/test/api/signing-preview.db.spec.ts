import { randomBytes } from 'node:crypto';
import { todayInIsrael } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { PREVIEW_WATERMARK } from '../../src/modules/pdf-filler/preview-watermark.js';
import { readPdfText } from '../fixtures/pdf-text.js';
import { asDataUrl, drawnPng } from '../fixtures/png.js';
import { createTestApp } from '../setup/app.js';
import { kioskServer, kioskVerified, openKiosk } from '../setup/kiosk.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  errorOf,
  type SigningRound,
  signingRound,
  signServer,
  validSubmit,
  verifiedCookie,
} from '../setup/signing.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * The preview before signing (6.5, B3a, FR-SGN-11): the signed PDF as submit builds it, with the
 * watermark on every page; nothing is saved. Behind one proxy, so the limit test picks its IP.
 */

const ENV = { TRUST_PROXY_HOPS: '1', SIGN_RATE_LIMIT_PREVIEW: '60' };

let app: INestApplication;
let prisma: PrismaService;
let storage: StorageAdapter;
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
  storage = app.get(StorageAdapter);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, ['1001', '1002']);
});

afterAll(async () => {
  await app.close();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const person = (number: string) => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};

/** The submit body without the reading statement (ticked on B3a). */
function previewBody(over: Record<string, unknown> = {}) {
  const body = validSubmit(over);
  delete body.acknowledged;
  return body;
}

const previewOf = (cookie: string, body: object = previewBody()) =>
  signServer(app)
    .post(`/api/sign/${person('1001').token}/preview`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
    })
    .send(body);

/** The pages that carry the watermark, and how many pages the file has. */
async function watermarkPages(bytes: Uint8Array) {
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  const marked = (await readPdfText(bytes))
    .filter(({ str }) => str === PREVIEW_WATERMARK)
    .map(({ page }) => page);
  return { pages, marked };
}

/** Everything a signature would write, to compare before and after a preview. */
async function written(assignmentId: string) {
  const row = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  return {
    status: row.status,
    signedAt: row.signedAt,
    signedFileKey: row.signedFileKey,
    signedFileSha256: row.signedFileSha256,
    responses: await prisma.assignmentResponse.count({ where: { assignmentId } }),
    emails: await prisma.emailMessage.count({ where: { assignmentId } }),
    sessions: await prisma.signingSession.count({ where: { assignmentId } }),
    pdfStored: await storage.exists(`rounds/${round.roundId}/15/1001.pdf`),
    drawingStored: await storage.exists(`responses/${assignmentId}/initials.png`),
  };
}

const bodyText = (response: { body: unknown }) =>
  JSON.parse((response.body as Buffer).toString('utf8')) as {
    error: { code: string; details?: unknown };
  };

describe('POST /api/sign/:token/preview', () => {
  it('200 PDF inline, no-store, the watermark on every page; nothing is saved', async () => {
    const { assignmentId } = person('1001');
    const cookie = await verifiedCookie(app, person('1001'));
    const before = await written(assignmentId);

    const response = await previewOf(cookie);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toMatch(/^inline; filename="preview\.pdf"/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    const bytes = response.body as Buffer;
    const { pages, marked } = await watermarkPages(bytes);
    expect(marked).toEqual(Array.from({ length: pages }, (_, index) => index + 1));
    const text = (await readPdfText(bytes)).map(({ str }) => str).join(' ');
    expect(text).toContain('דנה כהן');
    expect(text).toContain('אסמכתה');

    expect(await written(assignmentId)).toEqual(before);
    expect(before).toMatchObject({ status: 'opened', responses: 0, sessions: 1, pdfStored: false });

    const audits = await prisma.auditLog.findMany({ where: { action: 'sign.previewed' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: 'employee', entityId: assignmentId });
    expect(audits[0]?.details).toEqual({
      roundId: round.roundId,
      emailMessageId: expect.any(String) as unknown,
    });
    const auditText = JSON.stringify(audits[0]?.details);
    expect(auditText).not.toContain('dana');
    expect(auditText).not.toContain('דנה');
  });

  it('then submit signs, and the stored PDF has no watermark', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    expect((await previewOf(cookie)).status).toBe(200);
    const signed = await signServer(app)
      .post(`/api/sign/${person('1001').token}/submit`)
      .set('Cookie', cookie)
      .send(validSubmit());
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    const row = await prisma.assignment.findUniqueOrThrow({
      where: { id: person('1001').assignmentId },
    });
    const { marked } = await watermarkPages(await storage.download(row.signedFileKey ?? ''));
    expect(marked).toEqual([]);
  });

  it('401 without a session or with another link’s session', async () => {
    const none = await previewOf('');
    expect(none.status).toBe(401);
    expect(bodyText(none).error.code).toBe('SIGN_SESSION_EXPIRED');
    const other = await verifiedCookie(app, person('1002'));
    expect((await previewOf(other)).status).toBe(401);
  });

  it.each([
    ['signed', { status: 'signed' }, 409, 'SIGN_ALREADY_SIGNED'],
    ['cancelled', { status: 'cancelled' }, 409, 'SIGN_CANCELLED'],
    ['locked', { status: 'opened', locked: true }, 423, 'SIGN_LOCKED'],
  ] as const)('%s → %i %s with its state', async (state, change, status, code) => {
    const cookie = await verifiedCookie(app, person('1001'));
    await setState(prisma, person('1001').assignmentId, world.managerId, change);
    const response = await previewOf(cookie);
    expect(response.status).toBe(status);
    expect(bodyText(response).error).toMatchObject({ code, details: { state } });
  });

  it('expired → 409 SIGN_LINK_EXPIRED', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    const response = await previewOf(cookie);
    expect(response.status).toBe(409);
    expect(bodyText(response).error.code).toBe('SIGN_LINK_EXPIRED');
  });

  it('the same 400s as submit, at the same fields and keys; nothing logged', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    const answers = (over: Record<string, unknown>) => ({
      answers: { nickname: 'דנה כהן', shift: 'בוקר', start: todayInIsrael(), ...over },
    });
    const cases = [
      [{ emailChoice: undefined }, 'VALIDATION_FAILED', { fields: [{ field: 'emailChoice' }] }],
      [answers({ nickname: '' }), 'VALIDATION_FAILED', { fields: [{ field: 'answers.nickname' }] }],
      [answers({ nickname: 'שלום '.repeat(19) }), 'ANSWER_DOES_NOT_FIT', { key: 'nickname' }],
      [
        { drawings: { initials: asDataUrl(drawnPng({ width: 150, height: 80 })) } },
        'DRAWING_EMPTY',
        { key: 'initials' },
      ],
      [{ signatureImage: asDataUrl(drawnPng({})) }, 'SIGNATURE_EMPTY', undefined],
    ] as const;
    for (const [over, code, details] of cases) {
      const response = await previewOf(cookie, previewBody(over));
      expect(response.status, code).toBe(400);
      const { error } = bodyText(response);
      expect(error.code).toBe(code);
      if (details) expect(error.details).toMatchObject(details);
    }
    expect(await prisma.auditLog.count({ where: { action: 'sign.previewed' } })).toBe(0);
  });

  it('the reading statement is not part of the preview body (strict: 400)', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    const response = await previewOf(cookie, validSubmit());
    expect(response.status).toBe(400);
    expect(bodyText(response).error.code).toBe('VALIDATION_FAILED');
  });

  it('takes a body as large as submit (not the 100 KB limit); over 5 MB → 413', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    // 300 KB: past the default parser, so a 400 from the schema proves the large parser ran.
    const large = await previewOf(cookie, previewBody({ email: 'a'.repeat(300 * 1024) }));
    expect(large.status).toBe(400);
    expect(bodyText(large).error.code).toBe('VALIDATION_FAILED');
    const huge = await previewOf(cookie, previewBody({ email: 'a'.repeat(5 * 1024 * 1024) }));
    expect(huge.status).toBe(413);
  });

  it('has its own per-IP limit (SIGN_RATE_LIMIT_PREVIEW) → 429 with Retry-After', async () => {
    const ip = `198.51.100.${String(randomBytes(1)[0] ?? 7)}`;
    const send = () =>
      signServer(app)
        .post(`/api/sign/${person('1001').token}/preview`)
        .set('X-Forwarded-For', ip)
        .send(previewBody());
    // Counted before the session check: 60 refusals without a session use the window up.
    for (let index = 0; index < 60; index += 1) expect((await send()).status).toBe(401);
    const over = await send();
    expect(over.status).toBe(429);
    expect(errorOf(over).code).toBe('SIGN_TOO_MANY_REQUESTS');
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    const logged = await prisma.auditLog.findMany({ where: { action: 'sign.rate_limited' } });
    expect(logged.map(({ details }) => details)).toContainEqual({ scope: 'preview', limit: 60 });
  });
});

describe('POST /api/kiosk/preview', () => {
  const kioskPreview = (cookie: string, body: object = previewBody()) =>
    kioskServer(app)
      .post('/api/kiosk/preview')
      .set('Cookie', cookie)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .send(body);

  async function atKiosk() {
    const who = person('1001');
    const opened = await openKiosk(app, who.assignmentId, world.managerCookie);
    return kioskVerified(app, opened.code, who.idNumber);
  }

  it('200 watermarked PDF with the kiosk cookie only; nothing saved; one audit row', async () => {
    const { assignmentId } = person('1001');
    const cookie = await atKiosk();
    const before = await written(assignmentId);
    const response = await kioskPreview(cookie);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    const { pages, marked } = await watermarkPages(response.body as Buffer);
    expect(marked).toHaveLength(pages);
    expect(await written(assignmentId)).toEqual(before);
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'sign.previewed' } });
    expect(audit?.details).toMatchObject({
      emailMessageId: null,
      kioskSessionId: expect.any(String) as unknown,
    });
  });

  it('401 without the kiosk cookie; a link cookie opens nothing here', async () => {
    expect((await kioskPreview('')).status).toBe(401);
    const link = await verifiedCookie(app, person('1001'));
    expect((await kioskPreview(link)).status).toBe(401);
  });

  it('a cancelled assignment → 409; a staff user signed in → 409 KIOSK_STAFF_SIGNED_IN', async () => {
    const cookie = await atKiosk();
    const staff = await kioskPreview(`${world.managerCookie}; ${cookie}`);
    expect(staff.status).toBe(409);
    expect(bodyText(staff).error.code).toBe('KIOSK_STAFF_SIGNED_IN');
    await setState(prisma, person('1001').assignmentId, world.managerId, { status: 'cancelled' });
    const cancelled = await kioskPreview(cookie);
    expect(cancelled.status).toBe(409);
    expect(bodyText(cancelled).error.code).toBe('SIGN_CANCELLED');
  });

  it('the same 400 as submit at the kiosk', async () => {
    const cookie = await atKiosk();
    const response = await kioskPreview(cookie, previewBody({ emailChoice: undefined }));
    expect(response.status).toBe(400);
    expect(bodyText(response).error.code).toBe('VALIDATION_FAILED');
  });
});
