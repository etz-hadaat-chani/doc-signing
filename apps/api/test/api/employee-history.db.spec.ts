import { employeeHistoryItemSchema, pagedSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { createDraft, createTemplate, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { insertAssignment, insertRound, setState } from '../setup/tracking.js';

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
});

afterAll(async () => {
  await app.close();
});

const DAY = 86_400_000;
const paged = pagedSchema(employeeHistoryItemSchema);

function history(employeeId: string, query = '', cookie: string | null = world.managerCookie) {
  const req = request(httpServer(app)).get(`/api/employees/${employeeId}/assignments${query}`);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

it('lists every round of the employee, newest first, paged, with the links of a correction', async () => {
  const employeeId = world.emp['1001'] ?? '';
  const templateId = await createTemplate(app, world.managerCookie, 'חוזה שנתי', [world.dept[15]]);

  // Oldest: a signed round; then a returned one and its correction round; newest: a draft.
  const signedRound = await insertRound(prisma, world.managerId, {
    name: 'סבב 2025',
    createdAt: new Date(Date.now() - 30 * DAY),
  });
  const signed = await insertAssignment(prisma, signedRound, employeeId, templateId);
  await setState(prisma, signed, world.managerId, { status: 'signed' });

  const returnedRound = await insertRound(prisma, world.managerId, {
    name: 'סבב 2026',
    createdAt: new Date(Date.now() - 10 * DAY),
  });
  const returned = await insertAssignment(prisma, returnedRound, employeeId, templateId);
  await setState(prisma, returned, world.managerId, { status: 'cancelled', returned: true });
  const correctionRound = await insertRound(prisma, world.managerId, {
    name: 'תיקון: סבב 2026',
    createdAt: new Date(Date.now() - 5 * DAY),
    correctionOfAssignmentId: returned,
  });
  const correction = await insertAssignment(prisma, correctionRound, employeeId, templateId);
  await setState(prisma, correction, world.managerId, { status: 'sent', lastInvite: 'sent' });

  // Another document: the first one is still open for her in the correction round.
  const otherTemplateId = await createTemplate(app, world.managerCookie, 'נוהל', [world.dept[15]]);
  const draft = await createDraft(app, world.managerCookie, otherTemplateId, [employeeId]);
  // She moved after all of these: the history keeps the department of each round.
  await prisma.employee.update({
    where: { id: employeeId },
    data: { departmentId: world.dept[19] },
  });
  // Another employee's rounds never show.
  await insertAssignment(prisma, signedRound, world.emp['1002'] ?? '', templateId);

  const page1 = paged.parse((await history(employeeId, '?pageSize=2')).body);
  expect(page1).toMatchObject({ total: 4, page: 1, pageSize: 2 });
  expect(page1.items.map((item) => item.round.id)).toEqual([draft.id, correctionRound]);
  const page2 = paged.parse((await history(employeeId, '?pageSize=2&page=2')).body);
  expect(page2.items.map((item) => item.round.id)).toEqual([returnedRound, signedRound]);

  const [draftItem, correctionItem] = page1.items;
  const [returnedItem, signedItem] = page2.items;
  expect(draftItem).toMatchObject({
    round: { status: 'draft', statusLabel: 'טיוטה', correctionOf: null },
    displayStatus: 'pending',
    statusLabel: 'ממתין לשליחה',
    document: { id: otherTemplateId, name: 'נוהל', version: 1 },
    department: { code: 15, label: expect.stringMatching(/^15 - /) as unknown },
  });
  expect(correctionItem?.round.correctionOf).toEqual({ id: returnedRound, name: 'סבב 2026' });
  expect(correctionItem?.displayStatus).toBe('sent');
  expect(returnedItem).toMatchObject({
    assignmentId: returned,
    displayStatus: 'returned_for_correction',
    returned: { correctionRound: { id: correctionRound, name: 'תיקון: סבב 2026' } },
  });
  expect(signedItem).toMatchObject({
    assignmentId: signed,
    displayStatus: 'signed',
    hasSignedFile: true,
    signMethod: 'digital',
    approval: null,
    document: { id: templateId, name: 'חוזה שנתי', version: 1 },
  });
  expect(signedItem?.signedAt).not.toBeNull();
  const text = JSON.stringify([page1, page2]);
  expect(text).not.toMatch(/idNumber|fieldValues|returnNote|signedFileKey/);

  // The officer reads the same history.
  const officer = await history(employeeId, '?pageSize=2', world.officerCookie);
  expect(officer.status).toBe(200);
  expect(officer.body).toEqual(page1);
});

it('is empty for an employee in no round; 401 / 400 / 404', async () => {
  const employeeId = world.emp['1003'] ?? '';
  expect(paged.parse((await history(employeeId)).body)).toMatchObject({ total: 0, items: [] });
  expect((await history(employeeId, '', null)).status).toBe(401);
  expect((await history(employeeId, '?pageSize=0')).status).toBe(400);
  expect((await history(employeeId, '?status=sent')).status).toBe(400);
  expect((await history('00000000-0000-4000-8000-000000000000')).status).toBe(404);
});
