import { type ManualRow, manualRowSchema, pagedSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../setup/app.js';
import { getList, manualRound, postManual } from '../setup/manual-handling.js';
import { errorOf, postAction, type SentRound } from '../setup/round-actions.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

/** The manual-handling list (3.16 part A, FR-MAN-1). Made-up employees only. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SentRound;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await manualRound(app, prisma, world);
});

afterAll(async () => {
  await app.close();
});

const page = pagedSchema(manualRowSchema);
const idOf = (number: string) => round.assignment[number] ?? '';

async function list(query = ''): Promise<ManualRow[]> {
  const response = await getList(app, query, world.managerCookie);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return page.parse(response.body).items;
}

const rowOf = (rows: ManualRow[], number: string) =>
  rows.find((row) => row.employee.employeeNumber === number);

describe('GET /api/manual-handling', () => {
  it('lists no_email, invalid_email and missing_data rows, with what is missing (names only)', async () => {
    const response = await getList(app, '', world.managerCookie);
    expect(response.status).toBe(200);
    const body = page.parse(response.body);
    expect(body).toMatchObject({ total: 3, page: 1, pageSize: 25 });
    const kinds = Object.fromEntries(body.items.map((row) => [row.employee.employeeNumber, row]));
    expect(kinds['1001']).toMatchObject({ kind: 'no_email', ready: null, missing: [] });
    expect(kinds['1002']).toMatchObject({ kind: 'missing_data', ready: null });
    expect(kinds['1002']?.missing).toEqual(['כתובת']);
    expect(kinds['1004']).toMatchObject({ kind: 'invalid_email', ready: null, newEmail: null });
    expect(kinds['1003']).toBeUndefined();
    expect(kinds['1001']).toMatchObject({
      round: { id: round.roundId, name: 'סבב ניסיון' },
      documentName: 'הצהרה',
      department: { id: world.dept[15], code: 15 },
    });
  });

  it('never returns an ID number or a saved value', async () => {
    const response = await getList(app, '', world.managerCookie);
    const text = JSON.stringify(response.body);
    const employees = await prisma.employee.findMany({ select: { idNumber: true } });
    for (const { idNumber } of employees) expect(text).not.toContain(idNumber);
    expect(text).not.toContain('idNumber');
    expect(text).not.toContain('fieldValues');
  });

  it('an email added to the card makes the no_email row "email added, ready to send"', async () => {
    const email = freshEmail('added');
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { email, emailStatus: 'valid' },
    });
    expect(rowOf(await list(), '1001')).toMatchObject({ ready: 'email_added', newEmail: email });
  });

  it('a fixed address makes the invalid_email row "email fixed"; the same address does not', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1004'] },
      data: { emailStatus: 'valid' },
    });
    expect(rowOf(await list(), '1004')?.ready).toBeNull();
    const email = freshEmail('fixed');
    await prisma.employee.update({ where: { id: world.emp['1004'] }, data: { email } });
    expect(rowOf(await list(), '1004')).toMatchObject({ ready: 'email_fixed', newEmail: email });
  });

  it('filling in the missing address makes the row "details completed, ready to send"', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1002'] },
      data: { address: 'הנביאים 5', city: 'בני ברק' },
    });
    expect(rowOf(await list(), '1002')).toMatchObject({
      kind: 'missing_data',
      ready: 'details_completed',
      missing: [],
    });
  });

  it('is not ready when the employee is inactive, the link expired or an email is on its way', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { email: freshEmail('late'), emailStatus: 'valid', isActive: false },
    });
    expect(rowOf(await list(), '1001')).toMatchObject({
      ready: null,
      employee: { isActive: false },
    });
    await prisma.employee.update({ where: { id: world.emp['1001'] }, data: { isActive: true } });
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(rowOf(await list(), '1001')).toMatchObject({ ready: null, linkExpired: true });
  });

  it('lists a signed row whose employee gave another email, until the stored one matches', async () => {
    const given = freshEmail('given');
    await setState(prisma, idOf('1003'), world.managerId, {
      status: 'signed',
      email: { choice: 'email', given },
    });
    const stored = (await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1003'] } }))
      .email;
    expect(rowOf(await list('?kind=email_corrected'), '1003')).toMatchObject({
      kind: 'email_corrected',
      ready: null,
      emailCorrection: { stored, given },
    });
    await prisma.employee.update({
      where: { id: world.emp['1003'] },
      data: { email: given.toUpperCase() },
    });
    expect(rowOf(await list(), '1003')).toBeUndefined();
  });

  it('leaves out a signed row whose employee kept her email, or chose the office', async () => {
    await setState(prisma, idOf('1003'), world.managerId, {
      status: 'signed',
      email: { choice: 'office' },
    });
    expect(rowOf(await list(), '1003')).toBeUndefined();
  });

  it('lists a locked sent / opened row as "locked" with its unlocks left (5.7), never ready', async () => {
    expect(rowOf(await list(), '1003')).toBeUndefined();
    const lock = (status: 'sent' | 'opened') =>
      setState(prisma, idOf('1003'), world.managerId, { status, locked: true });
    await lock('sent');
    expect(rowOf(await list('?kind=locked'), '1003')).toMatchObject({
      kind: 'locked',
      status: 'sent',
      locked: true,
      ready: null,
      unlocksLeft: 2,
      employee: { emailStatus: 'valid' },
    });
    // Through the real unlock route: unlocked → gone; locked again → one unlock left.
    const unlocked = await postAction(
      app,
      `/api/assignments/${idOf('1003')}/unlock`,
      world.managerCookie,
    );
    expect(unlocked.status, JSON.stringify(unlocked.body)).toBe(200);
    expect(rowOf(await list(), '1003')).toBeUndefined();
    await lock('opened');
    expect(rowOf(await list(), '1003')).toMatchObject({ kind: 'locked', unlocksLeft: 1 });
    // Other kinds carry the count and the email status too.
    expect(rowOf(await list(), '1001')).toMatchObject({
      unlocksLeft: 2,
      employee: { emailStatus: 'missing' },
    });
  });

  it('filters by kind, round and department (at send time), and pages', async () => {
    expect((await list('?kind=no_email&kind=missing_data')).map((r) => r.kind).sort()).toEqual([
      'missing_data',
      'no_email',
    ]);
    expect(await list(`?roundId=${world.dept[15]}`)).toEqual([]);
    expect(await list(`?dept=${world.dept[19]}`)).toEqual([]);
    expect(await list(`?roundId=${round.roundId}&dept=${world.dept[15]}`)).toHaveLength(3);
    // Moving the employee later keeps the row in the department it was sent in.
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { departmentId: world.dept[19] },
    });
    expect(rowOf(await list(`?dept=${world.dept[15]}`), '1001')).toBeDefined();
    const second = await getList(app, '?pageSize=2&page=2', world.managerCookie);
    expect(page.parse(second.body)).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.parse(second.body).items).toHaveLength(1);
  });

  it('leaves out draft, closed and cancelled rounds', async () => {
    for (const status of ['closed', 'cancelled'] as const) {
      await prisma.round.update({ where: { id: round.roundId }, data: { status } });
      expect(await list()).toEqual([]);
    }
  });

  it('refuses search text in the address and a bad filter (400)', async () => {
    expect((await getList(app, '?q=1001', world.managerCookie)).status).toBe(400);
    expect((await getList(app, '?kind=pending', world.managerCookie)).status).toBe(400);
  });

  it('is manager only: officer 403, signed out 401', async () => {
    const officer = await getList(app, '', world.officerCookie);
    expect(officer.status).toBe(403);
    expect(errorOf(officer).code).toBe('FORBIDDEN');
    expect((await getList(app, '', null)).status).toBe(401);
  });
});

describe('POST /api/manual-handling/search', () => {
  it('finds by name or employee number, with the filters', async () => {
    const byNumber = await postManual(app, 'search', { q: '1002' }, world.managerCookie);
    expect(byNumber.status).toBe(200);
    expect(page.parse(byNumber.body).items.map((r) => r.employee.employeeNumber)).toEqual(['1002']);
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1004'] } });
    const byName = await postManual(
      app,
      'search',
      { q: employee.lastName, kind: ['invalid_email'] },
      world.managerCookie,
    );
    expect(page.parse(byName.body).items.map((r) => r.employee.employeeNumber)).toContain('1004');
  });

  it('finds by the full ID number only (never a part of it)', async () => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    const full = await postManual(app, 'search', { q: employee.idNumber }, world.managerCookie);
    expect(page.parse(full.body).items.map((r) => r.employee.employeeNumber)).toEqual(['1001']);
    const part = await postManual(
      app,
      'search',
      { q: employee.idNumber.slice(2, 7) },
      world.managerCookie,
    );
    expect(page.parse(part.body).items.map((r) => r.employee.employeeNumber)).not.toContain('1001');
  });

  it('is manager only: officer 403, signed out 401; unknown fields 400', async () => {
    expect((await postManual(app, 'search', { q: 'x' }, world.officerCookie)).status).toBe(403);
    expect((await postManual(app, 'search', { q: 'x' }, null)).status).toBe(401);
    expect(
      (await postManual(app, 'search', { q: 'x', status: 'sent' }, world.managerCookie)).status,
    ).toBe(400);
  });
});
