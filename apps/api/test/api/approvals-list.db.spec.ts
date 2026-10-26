import { randomUUID } from 'node:crypto';
import {
  type ApprovalRow,
  approvalRowSchema,
  assignmentResponsesSchema,
  EMAIL_CHOICE_LABELS,
  pagedSchema,
  todayInIsrael,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { getAs, personOf, waitingRound } from '../setup/approvals.js';
import { createTestApp } from '../setup/app.js';
import { errorOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import type { SigningRound } from '../setup/signing.js';

/** The approvals list and the answers view (3.16 part B2, FR-TRK-6): managers and officers. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;

const pageSchema = pagedSchema(approvalRowSchema);
const idOf = (number: string) => personOf(round, number).assignmentId;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  round = await waitingRound(app, prisma, world, ['1001', '1002', '1003']);
});

afterAll(async () => {
  await app.close();
});

async function list(query = '', cookie: string | null = world.managerCookie) {
  const response = await getAs(app, `/api/approvals${query}`, cookie);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return pageSchema.parse(response.body);
}

describe('GET /api/approvals', () => {
  it('lists the waiting rows, oldest signature first, with the boxes by label only', async () => {
    // 1003 signed first, then 1001, then 1002.
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await prisma.assignment.update({ where: { id: idOf('1003') }, data: { signedAt: at(30) } });
    await prisma.assignment.update({ where: { id: idOf('1001') }, data: { signedAt: at(20) } });
    await prisma.assignment.update({ where: { id: idOf('1002') }, data: { signedAt: at(10) } });

    const page = await list();
    expect(page.total).toBe(3);
    expect(page.items.map(({ assignmentId }) => assignmentId)).toEqual([
      idOf('1003'),
      idOf('1001'),
      idOf('1002'),
    ]);
    const [first] = page.items as [ApprovalRow];
    expect(first.round).toEqual({
      id: round.roundId,
      name: 'סבב ניסיון',
      status: 'active',
      isCorrection: false,
    });
    expect(first.document).toEqual({ id: round.templateId, name: 'הצהרת עובדת', version: 1 });
    expect(first.department.label).toMatch(/^15 - /);
    expect(first.signMethod).toBe('digital');
    expect(first.reasons).toEqual([{ key: 'nickname', label: 'שם לתעודה' }]);

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1003'] } });
    expect(first.employee).toEqual({
      id: employee.id,
      employeeNumber: '1003',
      firstName: employee.firstName,
      lastName: employee.lastName,
    });
    const body = JSON.stringify(page);
    for (const secret of [
      employee.idNumber,
      employee.email ?? '',
      'dana.new@example.com',
      'דנה כהן',
    ]) {
      expect(body).not.toContain(secret);
    }
    // Nothing is logged: the list shows no answers.
    expect(await prisma.auditLog.count({ where: { action: 'assignment.responses_viewed' } })).toBe(
      0,
    );
  });

  it('an officer gets the same list', async () => {
    expect(await list('', world.officerCookie)).toEqual(await list());
  });

  it('leaves out approved, returned, unflagged and manual rows', async () => {
    const manager = world.managerId;
    await prisma.assignment.update({
      where: { id: idOf('1001') },
      data: { approvedAt: new Date(), approvedById: manager },
    });
    await prisma.assignment.update({
      where: { id: idOf('1002') },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        returnedAt: new Date(),
        returnedById: manager,
        returnNote: 'תיקון',
      },
    });
    expect((await list()).items.map(({ assignmentId }) => assignmentId)).toEqual([idOf('1003')]);
    await prisma.assignment.update({
      where: { id: idOf('1003') },
      data: { needsApproval: false },
    });
    expect((await list()).total).toBe(0);
  });

  it('filters by round and pages', async () => {
    const other = await waitingRound(app, prisma, world, ['1004']);
    expect((await list(`?roundId=${other.roundId}`)).items).toHaveLength(1);
    expect((await list(`?roundId=${round.roundId}`)).total).toBe(3);
    expect((await list(`?roundId=${randomUUID()}`)).total).toBe(0);

    const second = await list('?page=2&pageSize=3');
    expect(second).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(second.items).toHaveLength(1);
  });

  it('400 for a bad query, 401 signed out', async () => {
    for (const query of ['?roundId=nope', '?page=0', '?pageSize=101', '?q=1001']) {
      const response = await getAs(app, `/api/approvals${query}`, world.managerCookie);
      expect(response.status, query).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    }
    expect((await getAs(app, '/api/approvals', null)).status).toBe(401);
  });
});

describe('GET /api/assignments/:id/responses', () => {
  const responses = async (assignmentId: string, cookie: string | null = world.managerCookie) => {
    const response = await getAs(app, `/api/assignments/${assignmentId}/responses`, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return assignmentResponsesSchema.parse(response.body);
  };

  it('every answer with its label, in template order; the drawing as a 5-minute link', async () => {
    const before = Date.now();
    const answers = await responses(idOf('1001'));
    expect(answers).toMatchObject({
      assignmentId: idOf('1001'),
      roundId: round.roundId,
      status: 'signed',
      approval: 'waiting',
      returnedAt: null,
      returnNote: null,
    });
    expect(
      answers.answers.map(({ key, label, type, needsApproval, value }) => ({
        key,
        label,
        type,
        needsApproval,
        value,
      })),
    ).toEqual([
      { key: 'nickname', label: 'שם לתעודה', type: 'text', needsApproval: true, value: 'דנה כהן' },
      { key: 'shift', label: 'משמרת', type: 'select', needsApproval: false, value: 'בוקר' },
      {
        key: 'start',
        label: 'תאריך התחלה',
        type: 'date_input',
        needsApproval: false,
        value: todayInIsrael(),
      },
      { key: 'agree', label: 'אני מסכימה', type: 'checkbox', needsApproval: false, value: 'true' },
      { key: 'initials', label: 'ראשי תיבות', type: 'drawing', needsApproval: false, value: null },
    ]);
    const drawing = answers.answers.at(-1)?.drawing;
    if (!drawing) throw new Error('no drawing link');
    const minutes = (new Date(drawing.expiresAt).getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(4.9);
    expect(minutes).toBeLessThan(5.1);
    const file = await fetch(drawing.url);
    expect(file.status).toBe(200);
    expect(
      Buffer.from(await file.arrayBuffer())
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
    expect(answers.answers.slice(0, -1).every(({ drawing: none }) => none === null)).toBe(true);
  });

  it('the email section: the address she gave and "differs", never the stored one', async () => {
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    const answers = await responses(idOf('1001'));
    expect(answers.emailAnswer).toEqual({
      choice: 'email',
      choiceLabel: EMAIL_CHOICE_LABELS.email,
      email: 'dana.new@example.com',
      differsFromStored: true,
    });
    expect(JSON.stringify(answers)).not.toContain(stored.email ?? '');
    expect(JSON.stringify(answers)).not.toContain(stored.idNumber);

    // The same address in other case and spaces counts as the same.
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { email: ' Dana.New@example.com' },
    });
    expect((await responses(idOf('1001'))).emailAnswer?.differsFromStored).toBe(false);
  });

  it('logged as a view with counts only', async () => {
    await responses(idOf('1001'));
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.responses_viewed' },
    });
    expect(audit).toMatchObject({
      userId: world.managerId,
      entityType: 'assignment',
      entityId: idOf('1001'),
    });
    expect(audit.details).toEqual({
      roundId: round.roundId,
      answerCount: 5,
      drawingCount: 1,
      emailShown: true,
    });
  });

  it('an officer reads the answers too (the view is logged under the officer)', async () => {
    const answers = await responses(idOf('1002'), world.officerCookie);
    expect(answers.answers).toHaveLength(5);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.responses_viewed' },
    });
    expect(audit.userId).not.toBe(world.managerId);
  });

  it('approved, returned (with its note) and a row without answers', async () => {
    await prisma.assignment.update({
      where: { id: idOf('1001') },
      data: { approvedAt: new Date(), approvedById: world.managerId },
    });
    expect((await responses(idOf('1001'))).approval).toBe('approved');

    await prisma.assignment.update({
      where: { id: idOf('1002') },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        returnedAt: new Date(),
        returnedById: world.managerId,
        returnNote: 'שורה ראשונה\nשורה שנייה',
      },
    });
    const returned = await responses(idOf('1002'), world.officerCookie);
    expect(returned).toMatchObject({ status: 'cancelled', approval: null });
    expect(returned.returnNote).toBe('שורה ראשונה\nשורה שנייה');
    expect(returned.returnedAt).not.toBeNull();
    expect(returned.answers).toHaveLength(5);

    const unsigned = await signingRoundRow();
    const empty = await responses(unsigned);
    expect(empty).toMatchObject({ approval: null, answers: [], emailAnswer: null });
  });

  it('404 unknown, 400 bad id, 401 signed out', async () => {
    const unknown = await getAs(
      app,
      `/api/assignments/${randomUUID()}/responses`,
      world.managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('ASSIGNMENT_NOT_FOUND');
    const bad = await getAs(app, '/api/assignments/nope/responses', world.managerCookie);
    expect(bad.status).toBe(400);
    expect((await getAs(app, `/api/assignments/${idOf('1001')}/responses`, null)).status).toBe(401);
  });
});

/** A row of the seed that never signed (no answers). */
async function signingRoundRow(): Promise<string> {
  const row = await prisma.assignment.create({
    data: {
      roundId: round.roundId,
      employeeId: world.emp['1005'] ?? '',
      departmentId: world.dept[15],
      templateId: round.templateId,
      status: 'sent',
    },
  });
  return row.id;
}
