import { createHash, randomUUID } from 'node:crypto';
import type { AssignmentStatus, RoundStatus } from '@doc-signing/shared';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';

/**
 * Builds the states 3.11 reads. Signing, approval, returns and reminders arrive in 3.12–3.16, so
 * tests set them directly in the database, within the table rules (the CHECKs of 1.4 / 3.9).
 */

/** What an assignment looks like; anything left out stays as it is. */
export interface AssignmentState {
  status: AssignmentStatus;
  locked?: boolean;
  /** signed: an answer needs approval; `approved` = a manager approved it. */
  approval?: 'waiting' | 'approved';
  /** cancelled: returned for correction. */
  returned?: boolean;
  /** The newest invitation: failed, sent, or sent without the provider's confirmation. */
  lastInvite?: 'failed' | 'sent' | 'unconfirmed';
  /** signed: the email section's answer. */
  email?: { choice: 'office' } | { choice: 'email'; given: string };
  /** signed: she filled in a box too. */
  answers?: boolean;
  reminderCount?: number;
  /** For the "last update" checks. */
  at?: Date;
}

const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

/** Puts one assignment into a state (the manager is the approver / returner). */
export async function setState(
  prisma: PrismaService,
  assignmentId: string,
  managerId: string,
  state: AssignmentState,
): Promise<void> {
  const at = state.at ?? new Date();
  const signed = state.status === 'signed' || state.status === 'signed_manual';
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: {
      status: state.status,
      lockedAt: state.locked ? at : null,
      failedAttempts: state.locked ? 5 : 0,
      signedAt: signed ? at : null,
      signedFileKey: signed ? `rounds/test/${assignmentId}.pdf` : null,
      signMethod: state.status === 'signed' ? 'digital' : signed ? 'manual' : null,
      needsApproval: state.approval !== undefined,
      approvedAt: state.approval === 'approved' ? at : null,
      approvedById: state.approval === 'approved' ? managerId : null,
      returnedAt: state.returned ? at : null,
      returnedById: state.returned ? managerId : null,
      returnNote: state.returned ? 'נא לתקן את הכתובת' : null,
      cancelledAt: state.status === 'cancelled' ? at : null,
      ...(state.reminderCount !== undefined && {
        reminderCount: state.reminderCount,
        lastReminderAt: state.reminderCount > 0 ? at : null,
      }),
    },
  });
  if (state.lastInvite !== undefined) await addInvite(prisma, assignmentId, state.lastInvite, at);
  if (state.email !== undefined) {
    await prisma.assignmentResponse.create({
      data: { assignmentId, key: 'email_choice', value: state.email.choice },
    });
    if (state.email.choice === 'email') {
      await prisma.assignmentResponse.create({
        data: { assignmentId, key: 'email', value: state.email.given },
      });
    }
  }
  if (state.answers) {
    await prisma.assignmentResponse.create({
      data: { assignmentId, key: 'start_date', value: '2026-11-01' },
    });
  }
}

/** One invitation row of an assignment, created at `at`. */
export async function addInvite(
  prisma: PrismaService,
  assignmentId: string,
  kind: 'failed' | 'sent' | 'unconfirmed' | 'queued',
  at: Date = new Date(),
): Promise<void> {
  const sent = kind === 'sent' || kind === 'unconfirmed';
  await prisma.emailMessage.create({
    data: {
      assignmentId,
      type: 'invite',
      toEmail: 'someone@example.com',
      status: sent ? 'sent' : kind,
      tokenHash: sent ? hash() : null,
      error:
        kind === 'failed' ? 'EENVELOPE' : kind === 'unconfirmed' ? 'UNCONFIRMED:ETIMEDOUT' : null,
      sentAt: sent ? at : null,
      createdAt: at,
      updatedAt: at,
    },
  });
}

/** A round inserted directly (no templates), e.g. many combinations or a correction round. */
export async function insertRound(
  prisma: PrismaService,
  createdById: string,
  data: {
    name?: string;
    status?: RoundStatus;
    sentAt?: Date | null;
    linkExpiresAt?: Date | null;
    createdAt?: Date;
    correctionOfAssignmentId?: string;
  } = {},
): Promise<string> {
  const round = await prisma.round.create({
    data: {
      name: data.name ?? 'סבב בדיקה',
      mode: 'single_template',
      status: data.status ?? 'active',
      linkExpiryDays: 60,
      sentAt: data.sentAt === undefined ? new Date() : data.sentAt,
      linkExpiresAt: data.linkExpiresAt ?? null,
      createdById,
      ...(data.createdAt && { createdAt: data.createdAt }),
      ...(data.correctionOfAssignmentId && {
        correctionOfAssignmentId: data.correctionOfAssignmentId,
      }),
    },
  });
  return round.id;
}

/** One assignment of an employee in a round, in her current department; returns its id. */
export async function insertAssignment(
  prisma: PrismaService,
  roundId: string,
  employeeId: string,
  templateId: string | null = null,
): Promise<string> {
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const row = await prisma.assignment.create({
    data: {
      roundId,
      employeeId,
      departmentId: employee.departmentId,
      templateId,
      // Without a template, an external file satisfies the document rule (1.4 CHECK).
      sourceFileKey: templateId === null ? `test/${employeeId}.pdf` : null,
    },
  });
  return row.id;
}
