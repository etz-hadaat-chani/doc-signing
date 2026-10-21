import { type ApiError, fieldValuesSchema, roundOutdatedTemplateSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { INVITATION_QUEUE, QUEUE_SCHEMA } from '../../src/common/queue/queue.definitions.js';
import { EMPLOYER_SIGNATURE_KEY } from '../../src/common/settings/settings.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { harGalXlsx } from '../fixtures/har-gal-workbook.js';
import { createTestApp, httpServer } from '../setup/app.js';
import {
  createDraft,
  createTemplate,
  postSend,
  type RoundsWorld,
  SEND_FIELDS,
  seedRoundsWorld,
  sendRound,
} from '../setup/rounds.js';
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

afterAll(async () => {
  await app.close();
});

const errorOf = (response: request.Response) => (response.body as ApiError).error;
const dept15 = ['1001', '1002', '1003'];
const ids = (numbers: string[]) => numbers.map((n) => world.emp[n] ?? '');

/** The invitation jobs waiting in pg-boss: their data and singleton key. */
async function invitationJobs() {
  return prisma.$queryRawUnsafe<{ data: Record<string, unknown>; singletonKey: string }[]>(
    `SELECT data, singleton_key AS "singletonKey" FROM "${QUEUE_SCHEMA}".job WHERE name = $1`,
    INVITATION_QUEUE.name,
  );
}

/** Assignments of a round by employee number. */
async function assignmentsOf(roundId: string) {
  const rows = await prisma.assignment.findMany({
    where: { roundId },
    include: { employee: { select: { employeeNumber: true } } },
  });
  return new Map(rows.map((row) => [row.employee.employeeNumber, row]));
}

/** Everything a send writes, to check that a refusal wrote nothing. */
async function sendWrites(roundId: string) {
  const round = await prisma.round.findUniqueOrThrow({ where: { id: roundId } });
  return {
    status: round.status,
    linkExpiresAt: round.linkExpiresAt,
    sentAt: round.sentAt,
    emails: await prisma.emailMessage.count(),
    jobs: (await invitationJobs()).length,
    savedValues: await prisma.assignment.count({
      where: { roundId, fieldValues: { not: Prisma.DbNull } },
    }),
    statuses: [...(await assignmentsOf(roundId)).values()].map((a) => a.status).sort(),
    audit: await prisma.auditLog.count({ where: { action: 'round.sent' } }),
  };
}

async function readyDraft(numbers = dept15) {
  const templateId = await createTemplate(app, world.managerCookie, 'חוזה', [world.dept[15]]);
  const round = await createDraft(app, world.managerCookie, templateId, ids(numbers));
  return { templateId, round };
}

describe('POST /api/rounds/:id/send: access and input', () => {
  it('sends for a manager (202), refuses an officer (403) and a signed-out caller (401)', async () => {
    const { round } = await readyDraft();
    expect((await postSend(app, round.id, {}, world.officerCookie)).status).toBe(403);
    expect((await postSend(app, round.id, {}, null)).status).toBe(401);
    expect((await postSend(app, round.id, {}, world.managerCookie)).status).toBe(202);
  });

  it('404 for an unknown round, 400 for a bad id or an unknown field', async () => {
    const unknown = await postSend(
      app,
      '00000000-0000-4000-8000-000000000999',
      {},
      world.managerCookie,
    );
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('ROUND_NOT_FOUND');
    expect((await postSend(app, 'not-a-uuid', {}, world.managerCookie)).status).toBe(400);
    const { round } = await readyDraft();
    const extra = await postSend(app, round.id, { force: true }, world.managerCookie);
    expect(extra.status).toBe(400);
  });

  it('a round that is not a draft → 409 ROUND_NOT_DRAFT, and nothing is sent again', async () => {
    const { round } = await readyDraft();
    await sendRound(app, world.managerCookie, round.id);
    const before = await sendWrites(round.id);
    const again = await postSend(app, round.id, {}, world.managerCookie);
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('ROUND_NOT_DRAFT');
    expect(await sendWrites(round.id)).toEqual(before);
    await prisma.round.update({ where: { id: round.id }, data: { status: 'cancelled' } });
    expect(errorOf(await postSend(app, round.id, {}, world.managerCookie)).code).toBe(
      'ROUND_NOT_DRAFT',
    );
  });

  it('two sends at the same moment: one 202, one 409; one job and one email row each', async () => {
    const { round } = await readyDraft();
    const [a, b] = await Promise.all([
      postSend(app, round.id, {}, world.managerCookie),
      postSend(app, round.id, {}, world.managerCookie),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect(await prisma.emailMessage.count()).toBe(3);
    expect(await invitationJobs()).toHaveLength(3);
  });
});

describe('POST /api/rounds/:id/send: what it saves', () => {
  it('saves values, sets the link expiry from the send, queues one IDs-only job per email', async () => {
    const { round } = await readyDraft();
    const sent = await sendRound(app, world.managerCookie, round.id);

    expect(sent.status).toBe('sending');
    expect(sent.counts).toEqual({ queued: 3, noEmail: 0, missingData: 0, cancelledInactive: 0 });
    const stored = await prisma.round.findUniqueOrThrow({ where: { id: round.id } });
    expect(stored.status).toBe('sending');
    expect(stored.sentAt?.toISOString()).toBe(sent.sentAt);
    expect(stored.linkExpiresAt?.getTime()).toBe(
      (stored.sentAt?.getTime() ?? 0) + 60 * 24 * 60 * 60 * 1000,
    );
    expect(stored.linkExpiresAt?.toISOString()).toBe(sent.linkExpiresAt);

    const assignments = await assignmentsOf(round.id);
    const employees = await prisma.employee.findMany({ where: { id: { in: ids(dept15) } } });
    for (const employee of employees) {
      const row = assignments.get(employee.employeeNumber);
      expect(row?.status).toBe('pending');
      const values = fieldValuesSchema.parse(row?.fieldValues);
      expect(values.values.id_number).toBe(employee.idNumber);
      expect(values.values.email_input).toBe(employee.email);
      expect(values.values.address).toBe('הרב קוק 12, ירושלים');
    }

    const emails = await prisma.emailMessage.findMany();
    expect(emails).toHaveLength(3);
    for (const email of emails) {
      expect(email).toMatchObject({ type: 'invite', status: 'queued', tokenHash: null });
      const employee = employees.find(
        (e) =>
          e.id === [...assignments.values()].find((a) => a.id === email.assignmentId)?.employeeId,
      );
      expect(email.toEmail).toBe(employee?.email);
    }

    const jobs = await invitationJobs();
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(Object.keys(job.data).sort()).toEqual(['assignmentId', 'emailMessageId']);
      expect(job.singletonKey).toBe(job.data.assignmentId);
      const text = JSON.stringify(job.data);
      for (const employee of employees) {
        expect(text).not.toContain(employee.idNumber);
        expect(text).not.toContain(employee.email ?? '@');
      }
    }
  });

  it('writes one round.sent audit row with ids and counts only, never values', async () => {
    const { round, templateId } = await readyDraft();
    await sendRound(app, world.managerCookie, round.id);
    const rows = await prisma.auditLog.findMany({ where: { action: 'round.sent' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'round',
      entityId: round.id,
      userId: world.managerId,
    });
    expect(rows[0]?.details).toMatchObject({
      templateIds: [templateId],
      outdatedTemplateIds: [],
      valuesSaved: 3,
      counts: { queued: 3, noEmail: 0, missingData: 0, cancelledInactive: 0 },
    });
    const text = JSON.stringify(rows[0]?.details);
    const employees = await prisma.employee.findMany({ where: { id: { in: ids(dept15) } } });
    for (const employee of employees) {
      for (const secret of [employee.idNumber, employee.email ?? '@', employee.firstName]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(text).not.toContain('הרב קוק');
  });

  it('a round with nobody to email becomes active at once, with no job', async () => {
    await prisma.employee.updateMany({
      where: { id: { in: ids(dept15) } },
      data: { email: null, emailStatus: 'missing' },
    });
    const { round } = await readyDraft();
    const sent = await sendRound(app, world.managerCookie, round.id);
    expect(sent.status).toBe('active');
    expect(sent.counts.noEmail).toBe(3);
    expect(await invitationJobs()).toHaveLength(0);
    expect((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'active',
    );
  });
});

describe('POST /api/rounds/:id/send: changes between create and send', () => {
  it('missing_data whose details were filled in → pending, values saved, emailed', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { address: null, city: null },
    });
    const { round } = await readyDraft();
    expect(round.counts.missingData).toBe(1);
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { address: 'רחוב השלום 4', city: 'אלעד' },
    });
    const sent = await sendRound(app, world.managerCookie, round.id);
    expect(sent.counts).toMatchObject({ queued: 3, missingData: 0 });
    const row = (await assignmentsOf(round.id)).get('1001');
    expect(row?.status).toBe('pending');
    expect(fieldValuesSchema.parse(row?.fieldValues).values.address).toBe('רחוב השלום 4, אלעד');
  });

  it('pending whose address was emptied before the send → missing_data, nothing saved or sent', async () => {
    const { round } = await readyDraft();
    await prisma.employee.update({
      where: { id: world.emp['1002'] },
      data: { address: null, city: null },
    });
    const sent = await sendRound(app, world.managerCookie, round.id);
    expect(sent.counts).toMatchObject({ queued: 2, missingData: 1 });
    const row = (await assignmentsOf(round.id)).get('1002');
    expect(row?.status).toBe('missing_data');
    expect(row?.fieldValues).toBeNull();
    expect(await prisma.emailMessage.count({ where: { assignmentId: row?.id } })).toBe(0);
  });

  it('pending whose email was removed or became invalid → no_email, values saved, no email', async () => {
    const { round } = await readyDraft();
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { email: null, emailStatus: 'missing' },
    });
    await prisma.employee.update({
      where: { id: world.emp['1002'] },
      data: { emailStatus: 'invalid' },
    });
    const sent = await sendRound(app, world.managerCookie, round.id);
    expect(sent.counts).toMatchObject({ queued: 1, noEmail: 2 });
    const rows = await assignmentsOf(round.id);
    for (const number of ['1001', '1002']) {
      const row = rows.get(number);
      expect(row?.status).toBe('no_email');
      expect(fieldValuesSchema.parse(row?.fieldValues).sendDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await prisma.emailMessage.count({ where: { assignmentId: row?.id } })).toBe(0);
    }
  });

  it('no_email whose employee now has a valid email → pending and emailed (draft never sent)', async () => {
    await prisma.employee.update({
      where: { id: world.emp['1003'] },
      data: { email: null, emailStatus: 'missing' },
    });
    const { round } = await readyDraft();
    expect(round.counts.noEmail).toBe(1);
    await prisma.employee.update({
      where: { id: world.emp['1003'] },
      data: { email: 'added.later@example.com', emailStatus: 'valid' },
    });
    const sent = await sendRound(app, world.managerCookie, round.id);
    expect(sent.counts).toMatchObject({ queued: 3, noEmail: 0 });
    const row = (await assignmentsOf(round.id)).get('1003');
    expect(row?.status).toBe('pending');
    const email = await prisma.emailMessage.findFirstOrThrow({ where: { assignmentId: row?.id } });
    expect(email.toEmail).toBe('added.later@example.com');
  });

  it('an employee made inactive → cancelled, nothing saved or sent', async () => {
    const { round } = await readyDraft();
    await prisma.employee.update({ where: { id: world.emp['1003'] }, data: { isActive: false } });
    const sent = await sendRound(app, world.managerCookie, round.id);
    expect(sent.counts).toMatchObject({ queued: 2, cancelledInactive: 1 });
    const row = (await assignmentsOf(round.id)).get('1003');
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelledAt?.toISOString()).toBe(sent.sentAt);
    expect(row?.fieldValues).toBeNull();
  });

  it('an employee moved to another department keeps the round department and template', async () => {
    const { round, templateId } = await readyDraft();
    await prisma.employee.update({
      where: { id: world.emp['1001'] },
      data: { departmentId: world.dept[19] },
    });
    await sendRound(app, world.managerCookie, round.id);
    const row = (await assignmentsOf(round.id)).get('1001');
    expect(row).toMatchObject({ status: 'pending', departmentId: world.dept[15], templateId });
  });

  it('an import after the send changes the employee, never the saved values', async () => {
    const { round } = await readyDraft();
    await sendRound(app, world.managerCookie, round.id);
    const before = (await assignmentsOf(round.id)).get('1001')?.fieldValues;

    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: world.emp['1001'] },
      include: { department: true },
    });
    const file = await harGalXlsx([
      {
        employeeNumber: employee.employeeNumber,
        idNumber: employee.idNumber,
        firstName: 'שם חדש',
        lastName: employee.lastName,
        department: `${String(employee.department.code)} - ${employee.department.name}`,
        email: 'changed.by.import@example.com',
      },
    ]);
    const preview = await request(httpServer(app))
      .post('/api/employees/import/preview')
      .set('Cookie', world.managerCookie)
      .attach('file', file, 'har-gal.xlsx');
    expect(preview.status).toBe(201);
    const batchId = (preview.body as { batchId: string }).batchId;
    const commit = await request(httpServer(app))
      .post(`/api/employees/import/${batchId}/commit`)
      .set('Cookie', world.managerCookie)
      .send();
    expect(commit.status).toBe(201);

    const changed = await prisma.employee.findUniqueOrThrow({ where: { id: world.emp['1001'] } });
    expect(changed.firstName).toBe('שם חדש');
    const after = (await assignmentsOf(round.id)).get('1001')?.fieldValues;
    expect(after).toEqual(before);
    expect(fieldValuesSchema.parse(after).values.full_name).not.toContain('שם חדש');
  });
});

describe('POST /api/rounds/:id/send: templates checked again', () => {
  it('a newer version since creation → 409 with the details; sent as is once confirmed', async () => {
    const { round, templateId } = await readyDraft();
    const renamed = await request(httpServer(app))
      .patch(`/api/templates/${templateId}`)
      .set('Cookie', world.managerCookie)
      .send({ name: 'חוזה מעודכן' });
    expect(renamed.status).toBe(200);
    const before = await sendWrites(round.id);

    const refused = await postSend(app, round.id, {}, world.managerCookie);
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('ROUND_TEMPLATE_OUTDATED');
    const [detail] = (errorOf(refused).details?.templates ?? []) as unknown[];
    expect(roundOutdatedTemplateSchema.parse(detail)).toEqual({
      id: templateId,
      name: 'חוזה',
      version: 1,
      reason: 'newer_version',
      newestVersion: 2,
      assignmentCount: 3,
    });
    expect(await sendWrites(round.id)).toEqual(before);

    const sent = await sendRound(app, world.managerCookie, round.id, {
      confirmOutdatedTemplateIds: [templateId],
    });
    expect(sent.outdatedTemplateIds).toEqual([templateId]);
    for (const row of (await assignmentsOf(round.id)).values()) {
      expect(row.templateId).toBe(templateId);
    }
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'round.sent' } });
    expect(audit.details).toMatchObject({ outdatedTemplateIds: [templateId] });
  });

  it('an archived template → 409 reason archived', async () => {
    const { round, templateId } = await readyDraft();
    const archived = await request(httpServer(app))
      .post(`/api/templates/${templateId}/archive`)
      .set('Cookie', world.managerCookie)
      .send();
    expect(archived.status).toBe(200);
    const refused = await postSend(app, round.id, {}, world.managerCookie);
    expect(errorOf(refused).code).toBe('ROUND_TEMPLATE_OUTDATED');
    expect(errorOf(refused).details?.templates).toEqual([
      expect.objectContaining({ id: templateId, reason: 'archived', newestVersion: null }),
    ]);
  });

  it('a confirmation that leaves out one outdated template → 409 naming both', async () => {
    const t15 = await createTemplate(app, world.managerCookie, 'חוזה 15', [world.dept[15]]);
    const t19 = await createTemplate(app, world.managerCookie, 'חוזה 19', [world.dept[19]]);
    const created = await request(httpServer(app))
      .post('/api/rounds')
      .set('Cookie', world.managerCookie)
      .send({
        name: 'לפי מחלקות',
        mode: 'by_department',
        recipients: { departmentIds: [world.dept[15], world.dept[19]] },
      });
    expect(created.status).toBe(201);
    const roundId = (created.body as { id: string }).id;
    for (const id of [t15, t19]) {
      await request(httpServer(app))
        .patch(`/api/templates/${id}`)
        .set('Cookie', world.managerCookie)
        .send({ name: 'גרסה חדשה' });
    }
    const refused = await postSend(
      app,
      roundId,
      { confirmOutdatedTemplateIds: [t15] },
      world.managerCookie,
    );
    expect(refused.status).toBe(409);
    const named = (errorOf(refused).details?.templates as { id: string }[]).map((t) => t.id);
    expect(named.sort()).toEqual([t15, t19].sort());
    await sendRound(app, world.managerCookie, roundId, { confirmOutdatedTemplateIds: [t15, t19] });
  });

  it('a template no longer ready → 409 ROUND_TEMPLATE_NOT_READY, nothing changes', async () => {
    const { round, templateId } = await readyDraft();
    // Not possible through the API (the template is locked); simulates a broken row.
    await prisma.templateField.deleteMany({ where: { templateId, fieldType: 'signature' } });
    const before = await sendWrites(round.id);
    const refused = await postSend(
      app,
      round.id,
      { confirmOutdatedTemplateIds: [templateId] },
      world.managerCookie,
    );
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('ROUND_TEMPLATE_NOT_READY');
    expect(errorOf(refused).details?.templates).toEqual([
      expect.objectContaining({
        id: templateId,
        reasons: [expect.objectContaining({ code: 'NO_MAIN_SIGNATURE' })],
      }),
    ]);
    expect(await sendWrites(round.id)).toEqual(before);
    expect(before).toMatchObject({ status: 'draft', emails: 0, jobs: 0, savedValues: 0 });
  });

  it('no employer signature image any more → 409, nothing changes', async () => {
    await prisma.setting.upsert({
      where: { key: EMPLOYER_SIGNATURE_KEY },
      create: { key: EMPLOYER_SIGNATURE_KEY, value: employerImage },
      update: { value: employerImage },
    });
    const templateId = await createTemplate(
      app,
      world.managerCookie,
      'חוזה חתום',
      [world.dept[15]],
      [...SEND_FIELDS, { fieldType: 'employer_signature' }],
      { employerSignatureMode: 'pre_signed' },
    );
    const round = await createDraft(app, world.managerCookie, templateId, ids(dept15));
    await prisma.setting.delete({ where: { key: EMPLOYER_SIGNATURE_KEY } });
    const before = await sendWrites(round.id);

    const refused = await postSend(app, round.id, {}, world.managerCookie);
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('ROUND_TEMPLATE_NOT_READY');
    expect(JSON.stringify(errorOf(refused).details)).toContain('EMPLOYER_SIGNATURE_IMAGE_MISSING');
    expect(await sendWrites(round.id)).toEqual(before);

    // With the image back, the saved values keep its key.
    await prisma.setting.create({ data: { key: EMPLOYER_SIGNATURE_KEY, value: employerImage } });
    await sendRound(app, world.managerCookie, round.id);
    const row = [...(await assignmentsOf(round.id)).values()][0];
    expect(fieldValuesSchema.parse(row?.fieldValues).employerSignature?.fileKey).toBe(
      employerImage.fileKey,
    );
  });
});

/** A stored employer signature setting (3.18 shape); the file itself isn't needed to send. */
const employerImage = {
  fileKey: 'settings/employer-signature/00000000-0000-4000-8000-000000000777.png',
  uploadedAt: '2026-10-01T08:00:00.000Z',
  width: 600,
  height: 200,
  sha256: 'a'.repeat(64),
};
