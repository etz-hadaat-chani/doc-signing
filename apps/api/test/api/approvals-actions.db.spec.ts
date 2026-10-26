import { randomUUID } from 'node:crypto';
import { approvedSchema, returnedSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { getAs, personOf, postApproval, returnRow, waitingRound } from '../setup/approvals.js';
import { createTestApp } from '../setup/app.js';
import { errorOf } from '../setup/round-actions.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { signServer, type SigningRound } from '../setup/signing.js';

/** Approve and return for correction (3.16 part B2, FR-TRK-6): manager only, under the locks. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;

const idOf = (number: string) => personOf(round, number).assignmentId;
const rowOf = (number: string) =>
  prisma.assignment.findUniqueOrThrow({ where: { id: idOf(number) } });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  round = await waitingRound(app, prisma, world, ['1001', '1002']);
});

afterAll(async () => {
  await app.close();
});

/** The signed file as stored: key, hash and bytes. */
async function signedFile(number: string) {
  const row = await rowOf(number);
  if (!row.signedFileKey) throw new Error('no signed file');
  const bytes = await app.get(StorageAdapter).download(row.signedFileKey);
  return { key: row.signedFileKey, sha256: row.signedFileSha256, bytes };
}

/** The 3.11 table row of one assignment. */
async function tableRow(number: string) {
  const response = await getAs(
    app,
    `/api/rounds/${round.roundId}/assignments?pageSize=100`,
    world.managerCookie,
  );
  expect(response.status).toBe(200);
  const items = (response.body as { items: { assignmentId: string }[] }).items;
  return items.find(({ assignmentId }) => assignmentId === idOf(number)) as Record<string, unknown>;
}

describe('POST /api/assignments/:id/approve', () => {
  it('approves; the signed file, its key and its hash never change; logged', async () => {
    const before = await signedFile('1001');
    const response = await postApproval(app, idOf('1001'), 'approve', world.managerCookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const approved = approvedSchema.parse(response.body);
    expect(approved.assignmentId).toBe(idOf('1001'));

    const row = await rowOf('1001');
    expect(row).toMatchObject({
      status: 'signed',
      needsApproval: true,
      approvedById: world.managerId,
    });
    expect(row.approvedAt?.toISOString()).toBe(approved.approvedAt);
    const after = await signedFile('1001');
    expect(after.key).toBe(before.key);
    expect(after.sha256).toBe(before.sha256);
    expect(after.bytes.equals(before.bytes)).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.approved' },
    });
    expect(audit).toMatchObject({ userId: world.managerId, entityId: idOf('1001') });
    expect(audit.details).toEqual({ roundId: round.roundId });

    expect((await tableRow('1001')).approval).toBe('approved');
    expect((await tableRow('1002')).approval).toBe('waiting');
    const list = await getAs(app, '/api/approvals', world.managerCookie);
    expect((list.body as { total: number }).total).toBe(1);
  });

  it('409 when not waiting: approved, returned, not flagged, not signed, signed manually', async () => {
    expect((await postApproval(app, idOf('1001'), 'approve', world.managerCookie)).status).toBe(
      200,
    );
    const twice = await postApproval(app, idOf('1001'), 'approve', world.managerCookie);
    expect(twice.status).toBe(409);
    expect(errorOf(twice)).toMatchObject({
      code: 'ASSIGNMENT_NOT_WAITING_FOR_APPROVAL',
      details: { status: 'signed', approved: true, returned: false },
    });

    await returnRow(app, world, idOf('1002'));
    const returned = await postApproval(app, idOf('1002'), 'approve', world.managerCookie);
    expect(returned.status).toBe(409);
    expect(errorOf(returned).details).toEqual({
      status: 'cancelled',
      approved: false,
      returned: true,
    });

    const others = await waitingRound(app, prisma, world, ['1003']);
    const other = personOf(others, '1003').assignmentId;
    for (const data of [
      { needsApproval: false },
      { status: 'sent' as const, needsApproval: false },
      { status: 'signed_manual' as const, needsApproval: false, signMethod: 'manual' as const },
    ]) {
      await prisma.assignment.update({ where: { id: other }, data });
      for (const action of ['approve', 'return'] as const) {
        const refused = await postApproval(app, other, action, world.managerCookie, { note: 'x' });
        expect(refused.status, JSON.stringify(data)).toBe(409);
        expect(errorOf(refused).code).toBe('ASSIGNMENT_NOT_WAITING_FOR_APPROVAL');
      }
    }
  });

  it('officer 403, signed out 401, unknown 404, bad id 400; nothing changes', async () => {
    const officer = await postApproval(app, idOf('1001'), 'approve', world.officerCookie);
    expect(officer.status).toBe(403);
    expect((await postApproval(app, idOf('1001'), 'approve', null)).status).toBe(401);
    const unknown = await postApproval(app, randomUUID(), 'approve', world.managerCookie);
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('ASSIGNMENT_NOT_FOUND');
    expect((await postApproval(app, 'nope', 'approve', world.managerCookie)).status).toBe(400);
    expect((await rowOf('1001')).approvedAt).toBeNull();
  });
});

describe('POST /api/assignments/:id/return', () => {
  it('cancels with the note; the signed file stays; the link reads "cancelled"; logged without the note', async () => {
    const note = '  יש לכתוב את השם בדיוק כמו בתעודה\nולחתום שוב  ';
    const before = await signedFile('1001');
    const response = await postApproval(app, idOf('1001'), 'return', world.managerCookie, { note });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const returned = returnedSchema.parse(response.body);
    expect(returned).toMatchObject({ assignmentId: idOf('1001'), status: 'cancelled' });

    const row = await rowOf('1001');
    expect(row).toMatchObject({
      status: 'cancelled',
      returnedById: world.managerId,
      returnNote: note.trim(),
      approvedAt: null,
    });
    expect(row.returnedAt?.toISOString()).toBe(returned.returnedAt);
    expect(row.cancelledAt?.toISOString()).toBe(returned.returnedAt);
    const after = await signedFile('1001');
    expect(after.key).toBe(before.key);
    expect(after.sha256).toBe(before.sha256);
    expect(after.bytes.equals(before.bytes)).toBe(true);

    const link = await signServer(app).get(`/api/sign/${personOf(round, '1001').token}`);
    expect(link.status).toBe(200);
    expect((link.body as { state: string }).state).toBe('cancelled');

    const details = await getAs(app, `/api/rounds/${round.roundId}`, world.managerCookie);
    const counts = (details.body as { counts: { byStatus: Record<string, number> } }).counts;
    expect(counts.byStatus).toMatchObject({ returned_for_correction: 1, cancelled: 0 });
    expect((await tableRow('1001')).cancelReason).toBe('returned');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'assignment.returned' },
    });
    expect(audit).toMatchObject({ userId: world.managerId, entityId: idOf('1001') });
    expect(audit.details).toEqual({ roundId: round.roundId, fromStatus: 'signed' });
    expect(JSON.stringify(audit.details)).not.toContain('בתעודה');
  });

  it('409 a second time; a 500-character note is fine', async () => {
    const note = 'א'.repeat(500);
    expect(
      (await postApproval(app, idOf('1001'), 'return', world.managerCookie, { note })).status,
    ).toBe(200);
    expect((await rowOf('1001')).returnNote).toBe(note);
    const twice = await postApproval(app, idOf('1001'), 'return', world.managerCookie, { note });
    expect(twice.status).toBe(409);
    expect(errorOf(twice).code).toBe('ASSIGNMENT_NOT_WAITING_FOR_APPROVAL');
  });

  it('400 for a missing, empty, too long note or an extra field; nothing changes', async () => {
    for (const body of [
      {},
      { note: '' },
      { note: '   \n ' },
      { note: 'א'.repeat(501) },
      { note: 5 },
      { note: 'תקין', status: 'signed' },
    ]) {
      const response = await postApproval(app, idOf('1001'), 'return', world.managerCookie, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    }
    expect((await rowOf('1001')).status).toBe('signed');
  });

  it('officer 403, signed out 401, unknown 404', async () => {
    const body = { note: 'תיקון' };
    expect(
      (await postApproval(app, idOf('1001'), 'return', world.officerCookie, body)).status,
    ).toBe(403);
    expect((await postApproval(app, idOf('1001'), 'return', null, body)).status).toBe(401);
    expect(
      (await postApproval(app, randomUUID(), 'return', world.managerCookie, body)).status,
    ).toBe(404);
    expect((await rowOf('1001')).status).toBe('signed');
  });
});
