import { createHash } from 'node:crypto';
import {
  ASSIGNMENT_STATUSES,
  type AssignmentStatus,
  DISPLAY_STATUSES,
  type DisplayStatus,
  displayStatus,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { displayStatusSql, lastInviteJoin } from '../../src/modules/tracking/display-status.sql.js';
import { createTestApp } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';
import { insertRound } from '../setup/tracking.js';

/**
 * The SQL twin (`displayStatusSql`) and the shared `displayStatus()` must agree on every
 * combination: stored status × locked × the invitations × approval × returned × the round's link
 * expiry (draft, future, past, exactly now). Change one rule without the other and this fails.
 */

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  await resetDatabase(prisma);
  await runSeed(prisma, { password: 'test-seed-password' });
});

afterAll(async () => {
  await app.close();
});

/** The invitation rows, oldest first: the newest one decides "send failed". */
const INVITES = [[], ['failed'], ['sent'], ['failed', 'sent'], ['sent', 'failed']] as const;
const APPROVALS = ['none', 'waiting', 'approved'] as const;

interface Combination {
  status: AssignmentStatus;
  locked: boolean;
  invites: readonly ('failed' | 'sent')[];
  approval: (typeof APPROVALS)[number];
  returned: boolean;
}

function combinations(): Combination[] {
  const list: Combination[] = [];
  for (const status of ASSIGNMENT_STATUSES) {
    for (const locked of [false, true]) {
      for (const invites of INVITES) {
        for (const approval of APPROVALS) {
          for (const returned of status === 'cancelled' ? [false, true] : [false]) {
            list.push({ status, locked, invites, approval, returned });
          }
        }
      }
    }
  }
  return list;
}

it('SQL and TypeScript give the same display value for every combination', async () => {
  const now = new Date();
  const manager = await prisma.user.findUniqueOrThrow({
    where: { email: 'manager@doc-signing.local' },
  });
  const department = await prisma.department.findFirstOrThrow();
  const combos = combinations();
  await prisma.employee.createMany({
    data: combos.map((_, i) => ({
      employeeNumber: String(70_000 + i),
      idNumber: String(600_000_000 + i),
      firstName: 'שרה',
      lastName: `בדיקה ${String(i)}`,
      departmentId: department.id,
      emailStatus: 'missing' as const,
    })),
  });
  const employees = await prisma.employee.findMany({
    where: { employeeNumber: { gte: '70000' } },
    orderBy: { employeeNumber: 'asc' },
  });
  const day = 86_400_000;
  const expiries = [null, new Date(now.getTime() + day), new Date(now.getTime() - day), now];

  const expected = new Map<string, DisplayStatus>();
  for (const linkExpiresAt of expiries) {
    const roundId = await insertRound(prisma, manager.id, {
      status: linkExpiresAt === null ? 'draft' : 'active',
      sentAt: linkExpiresAt === null ? null : new Date(now.getTime() - 2 * day),
      linkExpiresAt,
    });
    const rows = combos.map((combo, i) => {
      const signed = combo.status === 'signed' || combo.status === 'signed_manual';
      const at = new Date(now.getTime() - day);
      return {
        roundId,
        employeeId: employees[i]?.id ?? '',
        departmentId: department.id,
        // No template needed here: an external file satisfies the document rule.
        sourceFileKey: `test/${String(i)}.pdf`,
        status: combo.status,
        lockedAt: combo.locked ? at : null,
        failedAttempts: combo.locked ? 5 : 0,
        signedAt: signed ? at : null,
        signedFileKey: signed ? `rounds/${roundId}/${String(i)}.pdf` : null,
        needsApproval: combo.approval !== 'none',
        approvedAt: combo.approval === 'approved' ? at : null,
        approvedById: combo.approval === 'approved' ? manager.id : null,
        returnedAt: combo.returned ? at : null,
        returnedById: combo.returned ? manager.id : null,
        returnNote: combo.returned ? 'תיקון' : null,
      };
    });
    const created = await prisma.assignment.createManyAndReturn({
      data: rows,
      select: { id: true, employeeId: true },
    });
    const byEmployee = new Map(created.map((row) => [row.employeeId, row.id]));
    const emails = combos.flatMap((combo, i) => {
      const assignmentId = byEmployee.get(employees[i]?.id ?? '') ?? '';
      return combo.invites.map((kind, order) => ({
        assignmentId,
        type: 'invite' as const,
        toEmail: 'someone@example.com',
        status: kind,
        tokenHash:
          kind === 'sent'
            ? createHash('sha256')
                .update(`${assignmentId}${String(order)}`)
                .digest('hex')
            : null,
        createdAt: new Date(now.getTime() - 3 * day + order * 60_000),
      }));
    });
    await prisma.emailMessage.createMany({ data: emails });
    combos.forEach((combo, i) => {
      const assignmentId = byEmployee.get(employees[i]?.id ?? '') ?? '';
      const at = new Date(now.getTime() - day);
      expected.set(
        assignmentId,
        displayStatus(
          {
            status: combo.status,
            lockedAt: combo.locked ? at : null,
            linkExpiresAt,
            needsApproval: combo.approval !== 'none',
            approvedAt: combo.approval === 'approved' ? at : null,
            returnedAt: combo.returned ? at : null,
            lastInviteFailed: combo.invites.at(-1) === 'failed',
          },
          now,
        ),
      );
    });
  }

  const actual = await prisma.$queryRaw<{ id: string; status: DisplayStatus }[]>`
    SELECT a.id, ${displayStatusSql(now)} AS status
    FROM assignments a JOIN rounds r ON r.id = a.round_id
    ${lastInviteJoin}`;
  expect(actual).toHaveLength(expected.size);
  const mismatches = actual.filter(({ id, status }) => expected.get(id) !== status);
  expect(mismatches).toEqual([]);
  // Every display value occurred, so none of the rule's branches went untested.
  expect(new Set(actual.map(({ status }) => status))).toEqual(new Set(DISPLAY_STATUSES));
});
