import { templateItemSchema, todayInIsrael } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { type FieldSpec, layout } from '../fixtures/contracts.js';
import { PAGE, testPdf } from '../fixtures/pdf.js';
import { asDataUrl, drawnPng, signatureStrokes } from '../fixtures/png.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { signingRound, signServer, verifiedCookie } from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * Submit on a large contract (3.13): 20 pages, 35 positions, the signature on every page, 5
 * drawings at 750 × 300 (a 150% display) and long text. Tested under 3 s per signature.
 */

const LIMIT_MS = 3000;
const DRAWINGS = ['d1', 'd2', 'd3', 'd4', 'd5'];

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

/** Page 1: the form; page 2: five drawing boxes; every page: a signature. */
function bigLayout() {
  const first: FieldSpec[] = [
    { fieldType: 'full_name' },
    { fieldType: 'id_number' },
    { fieldType: 'address' },
    { fieldType: 'text', key: 'nickname', label: 'שם לתעודה' },
    { fieldType: 'long_text', key: 'notes', label: 'הערות', height: 80 },
    { fieldType: 'select', key: 'shift', label: 'משמרת', options: { choices: ['בוקר', 'ערב'] } },
    { fieldType: 'date_input', key: 'start', label: 'תאריך התחלה' },
    { fieldType: 'checkbox', key: 'agree', label: 'מסכימה', isRequired: false },
    { fieldType: 'email_input' },
    { fieldType: 'no_email_checkbox' },
    { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' } },
  ];
  const drawings: FieldSpec[] = DRAWINGS.map((key, index) => ({
    fieldType: 'drawing',
    key,
    label: `ציור ${String(index + 1)}`,
    y: 700 - index * 100,
    height: 80,
  }));
  const signatures = Array.from({ length: 20 }, (_, index) =>
    layout([{ fieldType: 'signature', y: 40, height: 40 }], index + 1),
  ).flat();
  return [...layout(first), ...layout(drawings, 2), ...signatures];
}

describe('submit on a 20-page contract', () => {
  it('stays under 3 s', { timeout: 120_000 }, async () => {
    const server = request(httpServer(app));
    const created = await server
      .post('/api/templates')
      .set('Cookie', world.managerCookie)
      .field('name', 'חוזה ארוך')
      .field('departmentIds', [world.dept[15], world.dept[19], world.dept[61]].join(','))
      .attach(
        'file',
        await testPdf({ pages: Array.from({ length: 20 }, () => PAGE.a4) }),
        'חוזה.pdf',
      );
    expect(created.status).toBe(201);
    const templateId = templateItemSchema.parse(created.body).id;
    const fields = bigLayout();
    expect(fields).toHaveLength(36);
    const patched = await request(httpServer(app))
      .patch(`/api/templates/${templateId}`)
      .set('Cookie', world.managerCookie)
      .send({ fields });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const round = await signingRound(
      app,
      prisma,
      world,
      ['1001', '1002', '1003'],
      [],
      {},
      templateId,
    );

    const big = asDataUrl(
      drawnPng({ width: 750, height: 300, strokes: signatureStrokes(750, 300), stroke: 3 }),
    );
    const body = {
      signatureImage: big,
      acknowledged: true,
      emailChoice: 'office',
      answers: {
        nickname: 'דנה כהן',
        notes: 'הערה ארוכה על העבודה, השעות והימים. '.repeat(4),
        shift: 'ערב',
        start: todayInIsrael(),
        agree: true,
      },
      drawings: Object.fromEntries(DRAWINGS.map((key) => [key, big])),
    };
    const timings: number[] = [];
    for (const who of Object.values(round.people)) {
      const cookie = await verifiedCookie(app, who);
      const started = performance.now();
      const response = await signServer(app)
        .post(`/api/sign/${who.token}/submit`)
        .set('Cookie', cookie)
        .send(body);
      timings.push(Math.round(performance.now() - started));
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    }
    expect(Math.max(...timings), `submit took ${timings.join(', ')} ms`).toBeLessThan(LIMIT_MS);
  });
});
