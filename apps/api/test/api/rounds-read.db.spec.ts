import {
  type ApiError,
  type AssignmentRow,
  assignmentRowSchema,
  DISPLAY_STATUSES,
  type DisplayStatus,
  emptyDisplayCounts,
  pagedSchema,
  roundDetailsSchema,
  roundListItemSchema,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';
import {
  createDraft,
  createTemplate,
  type RoundsWorld,
  seedRoundsWorld,
  sendRound,
} from '../setup/rounds.js';
import {
  type AssignmentState,
  insertAssignment,
  insertRound,
  setState,
} from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await app.close();
});

const pagedRows = pagedSchema(assignmentRowSchema);
const pagedRounds = pagedSchema(roundListItemSchema);
const errorOf = (response: request.Response) => (response.body as ApiError).error;
const ids = (numbers: string[]) => numbers.map((n) => world.emp[n] ?? '');
/** All 20 seed employees by employee number. */
const allNumbers = () => Object.keys(world.emp).sort();

function get(path: string, cookie: string | null = world.managerCookie) {
  const req = request(httpServer(app)).get(path);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

function search(roundId: string, body: object, cookie: string | null = world.managerCookie) {
  const req = request(httpServer(app)).post(`/api/rounds/${roundId}/assignments/search`).send(body);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

async function details(roundId: string) {
  const response = await get(`/api/rounds/${roundId}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return roundDetailsSchema.parse(response.body);
}

async function table(roundId: string, query = '') {
  const response = await get(`/api/rounds/${roundId}/assignments${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return pagedRows.parse(response.body);
}

/** Assignment ids of a round by employee number. */
async function assignmentsOf(roundId: string): Promise<Record<string, string>> {
  const rows = await prisma.assignment.findMany({
    where: { roundId },
    select: { id: true, employee: { select: { employeeNumber: true } } },
  });
  return Object.fromEntries(rows.map((row) => [row.employee.employeeNumber, row.id]));
}

/** A template for every department, a draft for these employees, sent (no worker: queued). */
async function sentRound(numbers: string[], name = 'סבב ניסיון') {
  const templateId = await createTemplate(
    app,
    world.managerCookie,
    'חוזה עובדים',
    Object.values(world.dept),
  );
  const draft = await createDraft(app, world.managerCookie, templateId, ids(numbers), { name });
  await sendRound(app, world.managerCookie, draft.id);
  return { roundId: draft.id, templateId, a: await assignmentsOf(draft.id) };
}

const rowOf = (rows: AssignmentRow[], assignmentId: string | undefined) => {
  const row = rows.find((item) => item.assignmentId === assignmentId);
  if (!row) throw new Error(`no row ${String(assignmentId)}`);
  return row;
};

describe('access', () => {
  it('signed out → 401 on every route; manager and officer read the same answers', async () => {
    const { roundId } = await sentRound(allNumbers().slice(0, 3));
    const employeeId = world.emp[allNumbers()[0] ?? ''] ?? '';
    const paths = [
      '/api/rounds',
      `/api/rounds/${roundId}`,
      `/api/rounds/${roundId}/assignments`,
      '/api/dashboard/summary',
      `/api/employees/${employeeId}/assignments`,
    ];
    for (const path of paths) {
      expect((await get(path, null)).status, path).toBe(401);
      const manager = await get(path);
      const officer = await get(path, world.officerCookie);
      expect(manager.status, path).toBe(200);
      expect(officer.status, path).toBe(200);
      expect(officer.body, path).toEqual(manager.body);
    }
    expect((await search(roundId, { q: 'א' }, null)).status).toBe(401);
    const manager = await search(roundId, { q: 'א' });
    const officer = await search(roundId, { q: 'א' }, world.officerCookie);
    expect(manager.status).toBe(200);
    expect(officer.body).toEqual(manager.body);
  });

  it('unknown round or employee → 404; a bad id → 400', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const path of [`/api/rounds/${unknown}`, `/api/rounds/${unknown}/assignments`]) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(errorOf(response).code).toBe('ROUND_NOT_FOUND');
    }
    expect((await search(unknown, {})).status).toBe(404);
    const employee = await get(`/api/employees/${unknown}/assignments`);
    expect(employee.status).toBe(404);
    expect(errorOf(employee).code).toBe('EMPLOYEE_NOT_FOUND');
    expect((await get('/api/rounds/not-a-uuid')).status).toBe(400);
  });

  it.each([
    '?status=xyz',
    '?dept=not-a-uuid',
    '?approval=yes',
    '?returned=maybe',
    '?pageSize=101',
    '?page=0',
    '?unknown=1',
    '?q=%D7%9B%D7%94%D7%9F',
  ])('a bad table filter → 400 with a Hebrew message (%s)', async (query) => {
    const { roundId } = await sentRound(allNumbers().slice(0, 1));
    const response = await get(`/api/rounds/${roundId}/assignments${query}`);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    expect(errorOf(response).message).toMatch(/[א-ת]/);
  });

  it('bad round list filters and search bodies → 400', async () => {
    expect((await get('/api/rounds?status=signed')).status).toBe(400);
    expect((await get('/api/rounds?sort=name')).status).toBe(400);
    const { roundId } = await sentRound(allNumbers().slice(0, 1));
    expect((await search(roundId, { q: 'x'.repeat(101) })).status).toBe(400);
    expect((await search(roundId, { status: ['nope'] })).status).toBe(400);
    expect((await search(roundId, { extra: true })).status).toBe(400);
  });
});

describe('drafts and sending', () => {
  it('a draft shows "טיוטה" and how long ago it was created; no link date, progress or %', async () => {
    const templateId = await createTemplate(app, world.managerCookie, 'חוזה', [world.dept[15]]);
    const draft = await createDraft(app, world.managerCookie, templateId, ids(['1001', '1002']));
    await prisma.round.update({
      where: { id: draft.id },
      data: { createdAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const list = pagedRounds.parse((await get('/api/rounds')).body);
    expect(list.items[0]).toMatchObject({
      id: draft.id,
      status: 'draft',
      statusLabel: 'טיוטה',
      draftAgeDays: 3,
      recipients: 2,
      signed: 0,
      percentSigned: null,
      linkExpiresAt: null,
      documents: [{ id: templateId, name: 'חוזה', version: 1 }],
    });
    const item = await details(draft.id);
    expect(item).toMatchObject({
      statusLabel: 'טיוטה',
      draftAgeDays: 3,
      sentAt: null,
      linkExpiresAt: null,
      progress: null,
      settings: { remindersEnabled: true, reminderIntervalDays: 3, linkExpiryDays: 60 },
      createdBy: { id: world.managerId },
      correctionOf: null,
    });
    expect(item.counts).toMatchObject({ total: 2, percentSigned: null });
    expect(item.counts.byStatus.pending).toBe(2);
    expect((await get('/api/rounds?status=active')).body).toMatchObject({ total: 0 });
    expect((await get('/api/rounds?status=draft')).body).toMatchObject({ total: 1 });
  });

  it('a sending round shows progress; an UNCONFIRMED invite is sent; a failed one is "send failed"', async () => {
    const { roundId, a } = await sentRound(['1001', '1002', '1003']);
    let item = await details(roundId);
    expect(item).toMatchObject({ status: 'sending', statusLabel: 'בשליחה', draftAgeDays: null });
    expect(item.sentAt).not.toBeNull();
    expect(item.linkExpiresAt).not.toBeNull();
    expect(item.progress).toEqual({ queued: 3, sent: 0, failed: 0, total: 3 });

    // What the invitation job does (3.10): one maybe-sent email, one that failed for good.
    await prisma.emailMessage.updateMany({
      where: { assignmentId: a['1001'] },
      data: { status: 'sent', error: 'UNCONFIRMED:ETIMEDOUT', tokenHash: 'a'.repeat(64) },
    });
    await prisma.assignment.update({
      where: { id: a['1001'] },
      data: { status: 'sent', sentAt: new Date() },
    });
    await prisma.emailMessage.updateMany({
      where: { assignmentId: a['1002'] },
      data: { status: 'failed', error: 'EENVELOPE' },
    });
    item = await details(roundId);
    expect(item.progress).toEqual({ queued: 1, sent: 1, failed: 1, total: 3 });
    expect(item.counts.byStatus).toMatchObject({ sent: 1, send_failed: 1, pending: 1 });
    const rows = (await table(roundId)).items;
    expect(rowOf(rows, a['1001'])).toMatchObject({ displayStatus: 'sent', statusLabel: 'נשלח' });
    expect(rowOf(rows, a['1002'])).toMatchObject({
      status: 'pending',
      displayStatus: 'send_failed',
      statusLabel: 'שליחה נכשלה',
    });
    expect(rowOf(rows, a['1003']).displayStatus).toBe('pending');
  });
});

describe('counts and filters', () => {
  it('counts every status and flag, and each filter returns exactly its count', async () => {
    const numbers = allNumbers();
    const { roundId, a } = await sentRound(numbers);
    const states: AssignmentState[] = [
      { status: 'pending' },
      { status: 'pending', lastInvite: 'failed' },
      { status: 'sent', lastInvite: 'sent', reminderCount: 2 },
      { status: 'sent', lastInvite: 'unconfirmed' },
      { status: 'opened' },
      { status: 'signed' },
      { status: 'signed', approval: 'approved' },
      { status: 'signed', approval: 'waiting', answers: true },
      { status: 'signed_manual' },
      { status: 'missing_data' },
      { status: 'no_email' },
      { status: 'invalid_email' },
      { status: 'cancelled' },
      { status: 'cancelled', returned: true },
      { status: 'opened', locked: true },
    ];
    const expected = emptyDisplayCounts();
    for (const [i, number] of numbers.entries()) {
      const state = states[i] ?? { status: 'pending' as const };
      if (i < states.length) await setState(prisma, a[number] ?? '', world.managerId, state);
      expected[
        ((): DisplayStatus => {
          if (state.locked) return 'locked';
          if (state.returned) return 'returned_for_correction';
          if (state.approval === 'waiting') return 'waiting_for_approval';
          if (state.lastInvite === 'failed') return 'send_failed';
          return state.status;
        })()
      ] += 1;
    }
    const item = await details(roundId);
    expect(item.counts.byStatus).toEqual(expected);
    expect(item.counts.total).toBe(numbers.length);
    // Signed 2 + waiting 1 + paper 1 of 20 − cancelled − returned = 4 of 18 → 22 %.
    expect(item.counts.percentSigned).toBe(22);
    expect(item.counts.byStatus.cancelled).toBe(1);
    expect(item.counts.byStatus.returned_for_correction).toBe(1);

    for (const status of DISPLAY_STATUSES) {
      const page = await table(roundId, `?status=${status}&pageSize=100`);
      expect(page.total, status).toBe(expected[status]);
      expect(
        page.items.every((row) => row.displayStatus === status),
        status,
      ).toBe(true);
    }
    const several = await table(roundId, '?status=sent&status=opened');
    expect(several.total).toBe(expected.sent + expected.opened);
    expect((await table(roundId, '?approval=waiting')).total).toBe(1);
    expect((await table(roundId, '?returned=true')).total).toBe(1);
    expect((await table(roundId, '?returned=false')).total).toBe(numbers.length - 1);
    expect((await table(roundId, '?status=sent&approval=waiting')).total).toBe(0);
    // The department filter adds up to the per-department counts.
    for (const department of item.departments) {
      expect((await table(roundId, `?dept=${department.id}`)).total).toBe(department.total);
    }

    const list = pagedRounds.parse((await get('/api/rounds')).body);
    expect(list.items[0]).toMatchObject({ recipients: 20, signed: 4, percentSigned: 22 });

    const rows = (await table(roundId, '?pageSize=100')).items;
    const waiting = rows.find((row) => row.displayStatus === 'waiting_for_approval');
    expect(waiting).toMatchObject({ approval: 'waiting', hasAnswers: true, hasSignedFile: true });
    const reminded = rows.find((row) => row.reminderCount === 2);
    expect(reminded?.lastReminderAt).not.toBeNull();
    const locked = rows.find((row) => row.displayStatus === 'locked');
    expect(locked).toMatchObject({ locked: true, status: 'opened' });
    expect(rows.find((row) => row.status === 'signed_manual')?.signMethod).toBe('manual');
  });

  it('an expired link is counted and filtered as expired', async () => {
    const roundId = await insertRound(prisma, world.managerId, {
      linkExpiresAt: new Date(Date.now() - 60_000),
    });
    const sent = await insertAssignment(prisma, roundId, world.emp['1001'] ?? '');
    await setState(prisma, sent, world.managerId, { status: 'sent', locked: true });
    const signed = await insertAssignment(prisma, roundId, world.emp['1002'] ?? '');
    await setState(prisma, signed, world.managerId, { status: 'signed' });
    const item = await details(roundId);
    expect(item.counts.byStatus).toMatchObject({ expired: 1, signed: 1, locked: 0 });
    const page = await table(roundId, '?status=expired');
    expect(page.items.map((row) => row.assignmentId)).toEqual([sent]);
    // Expired hides locked, but the row still says it is locked (the manager may unlock it).
    expect(page.items[0]?.locked).toBe(true);
  });

  it("shows the unlocks left per row from the unlock rule's own count (0 / 1 / 2 used)", async () => {
    const roundId = await insertRound(prisma, world.managerId);
    const [never, once, twice] = await Promise.all(
      ['1001', '1002', '1003'].map((n) => insertAssignment(prisma, roundId, world.emp[n] ?? '')),
    );
    const unlock = async (assignmentId: string | undefined) => {
      await setState(prisma, assignmentId ?? '', world.managerId, {
        status: 'opened',
        locked: true,
      });
      const response = await request(httpServer(app))
        .post(`/api/assignments/${assignmentId}/unlock`)
        .set('Cookie', world.managerCookie);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    };
    await setState(prisma, never ?? '', world.managerId, { status: 'opened', locked: true });
    await unlock(once);
    await unlock(twice);
    await unlock(twice);
    const page = await table(roundId);
    expect(rowOf(page.items, never).unlocksLeft).toBe(2);
    expect(rowOf(page.items, once).unlocksLeft).toBe(1);
    expect(rowOf(page.items, twice).unlocksLeft).toBe(0);
    // An officer reads the same number (the buttons are hidden, the data is not).
    const officer = await get(`/api/rounds/${roundId}/assignments`, world.officerCookie);
    expect(rowOf(pagedRows.parse(officer.body).items, twice).unlocksLeft).toBe(0);
  });

  it('counts and filters an employee in her department at send time, after she moved', async () => {
    const { roundId, a } = await sentRound(['1001', '1002']);
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { departmentId: world.dept[19] },
    });
    const item = await details(roundId);
    expect(item.departments.map(({ code, total }) => ({ code, total }))).toEqual([
      { code: 15, total: 2 },
    ]);
    const page = await table(roundId, `?dept=${world.dept[15]}`);
    expect(page.total).toBe(2);
    expect(rowOf(page.items, a['1001']).department).toMatchObject({ code: 15 });
    expect((await table(roundId, `?dept=${world.dept[19]}`)).total).toBe(0);
  });

  it('tells apart an employee cancelled at the send (inactive) from a manager cancel', async () => {
    const templateId = await createTemplate(app, world.managerCookie, 'חוזה', [world.dept[15]]);
    const draft = await createDraft(
      app,
      world.managerCookie,
      templateId,
      ids(['1001', '1002', '1003']),
    );
    await prisma.employee.update({ where: { id: world.emp['1002'] }, data: { isActive: false } });
    await sendRound(app, world.managerCookie, draft.id);
    const a = await assignmentsOf(draft.id);
    await setState(prisma, a['1003'] ?? '', world.managerId, { status: 'cancelled' });
    const item = await details(draft.id);
    expect(item.counts.byStatus.cancelled).toBe(2);
    expect(item.counts.cancelledInactiveAtSend).toBe(1);
    const rows = (await table(draft.id)).items;
    expect(rowOf(rows, a['1002']).cancelReason).toBe('inactive_at_send');
    expect(rowOf(rows, a['1003']).cancelReason).toBe('cancelled');
    expect(rowOf(rows, a['1001']).cancelReason).toBeNull();
  });
});

describe('the email section and the audit row', () => {
  it('shows the answer of signed rows, with "differs", and logs pages that show addresses', async () => {
    const { roundId, a } = await sentRound(['1001', '1002', '1003', '1004']);
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    const storedOther = await prisma.employee.findUniqueOrThrow({
      where: { id: world.emp['1002'] },
    });
    await setState(prisma, a['1001'] ?? '', world.managerId, {
      status: 'signed',
      email: { choice: 'email', given: stored.email ?? '' },
    });
    await setState(prisma, a['1002'] ?? '', world.managerId, {
      status: 'signed',
      email: { choice: 'email', given: 'new-address@example.com' },
    });
    await setState(prisma, a['1003'] ?? '', world.managerId, {
      status: 'signed',
      email: { choice: 'office' },
    });
    const auditBefore = await prisma.auditLog.count({
      where: { action: 'round.assignments_viewed' },
    });

    const response = await get(`/api/rounds/${roundId}/assignments`);
    const rows = pagedRows.parse(response.body).items;
    expect(rowOf(rows, a['1001']).emailAnswer).toEqual({
      choice: 'email',
      choiceLabel: 'מייל',
      email: stored.email,
      differsFromStored: false,
    });
    expect(rowOf(rows, a['1002']).emailAnswer).toEqual({
      choice: 'email',
      choiceLabel: 'מייל',
      email: 'new-address@example.com',
      differsFromStored: true,
    });
    expect(rowOf(rows, a['1003']).emailAnswer).toEqual({
      choice: 'office',
      choiceLabel: 'במשרד',
      email: null,
      differsFromStored: false,
    });
    expect(rowOf(rows, a['1004']).emailAnswer).toBeNull();
    // Never the stored address of an employee who gave another one, never an ID number.
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(storedOther.email ?? '');
    expect(text).not.toContain(stored.idNumber);
    expect(text).not.toMatch(/idNumber|fieldValues|returnNote|signedFileKey/);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'round.assignments_viewed' },
    });
    expect(audits).toHaveLength(auditBefore + 1);
    expect(audits.at(-1)).toMatchObject({
      entityType: 'round',
      entityId: roundId,
      userId: world.managerId,
      details: { page: 1, pageSize: 25, rowCount: 4, emailAnswersShown: 2, searched: false },
    });
    expect(JSON.stringify(audits.at(-1)?.details)).not.toContain('@');

    // A page without given addresses, the details and the list write nothing.
    await table(roundId, '?status=pending');
    await details(roundId);
    await get('/api/rounds');
    expect(await prisma.auditLog.count({ where: { action: 'round.assignments_viewed' } })).toBe(
      auditBefore + 1,
    );
  });
});

describe('returned for correction', () => {
  it('counts a returned row apart from cancelled, and links it to its correction round and back', async () => {
    const { roundId, a, templateId } = await sentRound(['1001', '1002'], 'חוזה שנתי 2027');
    await setState(prisma, a['1001'] ?? '', world.managerId, {
      status: 'cancelled',
      returned: true,
    });
    let row = rowOf((await table(roundId)).items, a['1001']);
    expect(row).toMatchObject({
      displayStatus: 'returned_for_correction',
      statusLabel: 'הוחזר לתיקון',
      cancelReason: 'returned',
      returned: { correctionRound: null },
    });

    const correctionId = await insertRound(prisma, world.managerId, {
      name: 'תיקון: חוזה שנתי 2027 – ישראלה',
      correctionOfAssignmentId: a['1001'] ?? '',
    });
    await insertAssignment(prisma, correctionId, world.emp['1001'] ?? '', templateId);

    row = rowOf((await table(roundId)).items, a['1001']);
    expect(row.returned?.correctionRound).toEqual({
      id: correctionId,
      name: 'תיקון: חוזה שנתי 2027 – ישראלה',
    });
    const original = await details(roundId);
    expect(original.counts.byStatus).toMatchObject({ returned_for_correction: 1, cancelled: 0 });
    expect(original.correctionOf).toBeNull();
    const correction = await details(correctionId);
    expect(correction.isCorrection).toBe(true);
    expect(correction.correctionOf).toEqual({
      roundId,
      roundName: 'חוזה שנתי 2027',
      assignmentId: a['1001'],
    });
    const list = pagedRounds.parse((await get('/api/rounds')).body);
    expect(list.items.find((item) => item.id === correctionId)?.isCorrection).toBe(true);
    expect(list.items.find((item) => item.id === roundId)?.isCorrection).toBe(false);
  });
});

describe('search, paging and order', () => {
  it('searches by name, employee number and full ID number, with no ID number in any log', async () => {
    const numbers = allNumbers();
    const { roundId, a } = await sentRound(numbers);
    const target = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1004'] } });
    const messages: string[] = [];
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        messages.push(String(message));
      });
    }

    const found = async (body: object) => {
      const response = await search(roundId, body);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return pagedRows.parse(response.body);
    };
    const byName = await found({ q: `${target.firstName} ${target.lastName}` });
    expect(byName.items.map((row) => row.assignmentId)).toContain(a['1004']);
    expect((await found({ q: target.lastName })).items.map((row) => row.assignmentId)).toContain(
      a['1004'],
    );
    expect((await found({ q: '1004' })).items.map((row) => row.assignmentId)).toEqual([a['1004']]);
    const byId = await found({ q: target.idNumber });
    expect(byId.items.map((row) => row.assignmentId)).toEqual([a['1004']]);
    expect(byId.total).toBe(1);
    // Part of an ID never matches.
    expect((await found({ q: target.idNumber.slice(0, 6) })).total).toBe(0);
    // Search and filters combine.
    expect((await found({ q: target.idNumber, status: ['signed'] })).total).toBe(0);
    expect((await found({ q: target.idNumber, status: ['pending'] })).total).toBe(1);

    const everything = [
      ...messages,
      JSON.stringify(await prisma.auditLog.findMany({ select: { details: true } })),
    ].join('\n');
    expect(everything).not.toContain(target.idNumber);
  });

  it('pages the table by department code, last name and first name', async () => {
    const { roundId } = await sentRound(allNumbers());
    const seen: AssignmentRow[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const result = await table(roundId, `?pageSize=5&page=${String(page)}`);
      expect(result).toMatchObject({ total: 20, page, pageSize: 5 });
      expect(result.items).toHaveLength(5);
      seen.push(...result.items);
    }
    expect(new Set(seen.map((row) => row.assignmentId)).size).toBe(20);
    const keys = seen.map((row) => [row.department.code, row.lastName, row.firstName] as const);
    const sorted = [...keys].sort(
      (x, y) => x[0] - y[0] || x[1].localeCompare(y[1], 'he') || x[2].localeCompare(y[2], 'he'),
    );
    expect(keys.map((key) => key[0])).toEqual(sorted.map((key) => key[0]));
    expect((await table(roundId, '?pageSize=5&page=5')).items).toEqual([]);
  });

  it('lists rounds newest first, paged', async () => {
    const first = await sentRound(['1001'], 'ראשון');
    const second = await sentRound(['1002'], 'שני');
    await prisma.round.update({
      where: { id: first.roundId },
      data: { createdAt: new Date(Date.now() - 86_400_000) },
    });
    const page1 = pagedRounds.parse((await get('/api/rounds?pageSize=1')).body);
    expect(page1).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page1.items.map((item) => item.id)).toEqual([second.roundId]);
    const page2 = pagedRounds.parse((await get('/api/rounds?pageSize=1&page=2')).body);
    expect(page2.items.map((item) => item.id)).toEqual([first.roundId]);
  });
});
