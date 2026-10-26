import {
  type AssignmentStatus,
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  type FieldValues,
  type ManualKind,
  MANUAL_PRINTABLE_STATUSES,
  type RoundStatus,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import { searchCondition } from '../employees/employee-search.js';
import { recipientColumns } from '../rounds/round-recipients.repository.js';
import type { SendableRow } from '../rounds/round-send.repository.js';

/** The list's filters as the repository runs them. */
export interface ManualListFilter {
  roundId: string | undefined;
  departmentId: string | undefined;
  /** Kinds to keep; null = all. */
  kinds: ManualKind[] | null;
  q: string | undefined;
  page: number;
  pageSize: number;
}

/** One list row with the facts the send rule needs (the service decides "ready"). */
export interface ManualListRow {
  assignmentId: string;
  kind: ManualKind;
  status: AssignmentStatus;
  roundId: string;
  roundName: string;
  roundStatus: RoundStatus;
  linkExpiresAt: Date | null;
  /** The database clock, for the expiry check. */
  now: Date;
  templateId: string | null;
  documentName: string | null;
  departmentId: string;
  departmentCode: number;
  departmentName: string;
  employeeId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  employeeActive: boolean;
  locked: boolean;
  validEmail: string | null;
  emailQueued: boolean;
  /** The address of the newest invitation or reminder that failed or bounced (as resend reads it). */
  failedAddress: string | null;
  storedEmail: string | null;
  givenEmail: string | null;
  sentAt: Date | null;
  signedAt: Date | null;
}

/** One assignment as the values step reads it (see `RoundSendRepository.lockSendable`). */
export type ValuesInput = Pick<SendableRow, 'id' | 'templateId' | 'department' | 'employee'>;

/** One assignment as print and the scanned signature see it. */
export interface DocumentFacts {
  assignmentId: string;
  roundId: string;
  status: AssignmentStatus;
  templateId: string | null;
  /** `field_values` as stored (checked with `fieldValuesSchema` by the caller). */
  fieldValues: unknown;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  /** The department at send time (`assignments.department_id`), for the file path. */
  departmentCode: number;
  roundStatus: RoundStatus;
  linkExpiresAt: Date | null;
  now: Date;
}

export interface ManualSignedWrite {
  assignmentId: string;
  fileKey: string;
  fileSha256: string;
  handledById: string;
}

/** The statuses that put a row in the list (signed: only when she corrected her email). */
const LISTED_STATUSES = ['no_email', 'invalid_email', 'missing_data', 'signed'];

/**
 * Why the row is listed, or NULL. The three open kinds only in a sent round that is still open
 * (draft rows go with the round's send; closed or cancelled rounds are over). A corrected email
 * (FR-SGN-9) in any round: the address still has to be fixed in Har Gal.
 */
const KIND_SQL = Prisma.sql`CASE
  WHEN a.status IN ('no_email', 'invalid_email', 'missing_data')
       AND r.status IN ('sending', 'active') THEN a.status::text
  WHEN a.status = 'signed' AND rc.value = 'email' AND re.value IS NOT NULL
       AND lower(btrim(re.value)) IS DISTINCT FROM lower(btrim(e.email)) THEN 'email_corrected'
END`;

/**
 * Manual handling (3.16): the list query, the facts the send reads, and every status change of
 * the send and the scanned signature (CLAUDE.md layering). Lock order, as in 3.10 and 3.12: the
 * round rows first (`RoundActionsRepository.lockRound`, in id order), then the assignments.
 */
@Injectable()
export class ManualHandlingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of the list and the total. One inner query computes the kind per row; the outer
   * one filters by kind, orders (round sent newest first, department, name) and pages.
   */
  async listPage(filter: ManualListFilter): Promise<{ rows: ManualListRow[]; total: number }> {
    const conditions = [Prisma.sql`a.status::text = ANY(${LISTED_STATUSES}::text[])`];
    if (filter.roundId !== undefined) {
      conditions.push(Prisma.sql`a.round_id = ${filter.roundId}::uuid`);
    }
    if (filter.departmentId !== undefined) {
      conditions.push(Prisma.sql`a.department_id = ${filter.departmentId}::uuid`);
    }
    if (filter.q !== undefined) conditions.push(searchCondition(filter.q));
    const inner = Prisma.sql`
      SELECT ${KIND_SQL} AS kind,
             a.id AS "assignmentId", a.status::text AS status,
             r.id AS "roundId", r.name AS "roundName", r.status::text AS "roundStatus",
             r.link_expires_at AS "linkExpiresAt", now() AS now,
             a.template_id AS "templateId", t.name AS "documentName",
             d.id AS "departmentId", d.code AS "departmentCode", d.name AS "departmentName",
             e.id AS "employeeId", e.employee_number AS "employeeNumber",
             e.first_name AS "firstName", e.last_name AS "lastName",
             e.is_active AS "employeeActive", a.locked_at IS NOT NULL AS locked,
             CASE WHEN e.email_status = 'valid' AND btrim(coalesce(e.email, '')) <> ''
                  THEN e.email END AS "validEmail",
             EXISTS (SELECT 1 FROM email_messages q
                     WHERE q.assignment_id = a.id AND q.type IN ('invite', 'reminder')
                       AND q.status = 'queued') AS "emailQueued",
             fa.to_email AS "failedAddress",
             e.email AS "storedEmail", re.value AS "givenEmail",
             coalesce(a.sent_at, r.sent_at) AS "sentAt", a.signed_at AS "signedAt"
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN employees e ON e.id = a.employee_id
      JOIN departments d ON d.id = a.department_id
      LEFT JOIN templates t ON t.id = a.template_id
      LEFT JOIN assignment_responses rc ON rc.assignment_id = a.id AND rc.key = ${EMAIL_CHOICE_KEY}
      LEFT JOIN assignment_responses re ON re.assignment_id = a.id AND re.key = ${EMAIL_ANSWER_KEY}
      LEFT JOIN LATERAL (
        SELECT em.to_email
        FROM email_messages em
        WHERE em.assignment_id = a.id AND em.type IN ('invite', 'reminder')
          AND em.status IN ('failed', 'bounced')
        ORDER BY em.created_at DESC, em.id DESC
        LIMIT 1
      ) fa ON a.status = 'invalid_email'
      WHERE ${Prisma.join(conditions, ' AND ')}`;
    const outer = [Prisma.sql`m.kind IS NOT NULL`];
    if (filter.kinds !== null) outer.push(Prisma.sql`m.kind = ANY(${filter.kinds}::text[])`);
    const where = Prisma.sql`WHERE ${Prisma.join(outer, ' AND ')}`;
    const [rows, [count]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ManualListRow[]>`
        SELECT m.* FROM (${inner}) m
        ${where}
        ORDER BY m."sentAt" DESC NULLS LAST, m."departmentCode", m."lastName", m."firstName",
                 m."assignmentId"
        LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM (${inner}) m ${where}`,
    ]);
    return { rows, total: Number(count?.total ?? 0) };
  }

  /** The round of each assignment that exists (no lock: the caller locks the rounds next). */
  async roundsOf(assignmentIds: readonly string[], db: Db): Promise<Map<string, string>> {
    const rows = await db.assignment.findMany({
      where: { id: { in: [...assignmentIds] } },
      select: { id: true, roundId: true },
    });
    return new Map(rows.map(({ id, roundId }) => [id, roundId]));
  }

  /**
   * What the values step needs for these assignments (already locked by the caller): the
   * template version, the department at creation and the employee as stored now.
   */
  async valuesInputs(
    assignmentIds: readonly string[],
    db: Db = this.prisma,
  ): Promise<ValuesInput[]> {
    if (assignmentIds.length === 0) return [];
    const rows = await db.assignment.findMany({
      where: { id: { in: [...assignmentIds] } },
      select: { id: true, templateId: true, departmentId: true, employeeId: true },
      orderBy: { id: 'asc' },
    });
    const employees = await db.employee.findMany({
      where: { id: { in: [...new Set(rows.map(({ employeeId }) => employeeId))] } },
      select: recipientColumns,
    });
    const departments = await db.department.findMany({
      where: { id: { in: [...new Set(rows.map(({ departmentId }) => departmentId))] } },
      select: { id: true, code: true, name: true },
    });
    const employeeById = new Map(employees.map((row) => [row.id, row]));
    const departmentById = new Map(departments.map((row) => [row.id, row]));
    return rows.map((row) => {
      const employee = employeeById.get(row.employeeId);
      const department = departmentById.get(row.departmentId);
      if (!employee || !department || row.templateId === null) {
        throw new Error(`Assignment ${row.id} is missing its employee, department or template`);
      }
      return { id: row.id, templateId: row.templateId, department, employee };
    });
  }

  /** "Email added": `no_email` → `pending` (its saved values stay); the invitation's job sends it. */
  async reopenNoEmail(assignmentId: string, db: Db): Promise<void> {
    const changed = await db.assignment.updateMany({
      where: { id: assignmentId, status: 'no_email' },
      data: { status: 'pending' },
    });
    if (changed.count !== 1) throw new Error('Assignment changed while sending');
  }

  /**
   * "Details completed": the values are saved now (FR-RND-8) and the row becomes `pending` (an
   * invitation follows) or `no_email`. Only from `missing_data` with nothing saved yet: saved
   * values are never rebuilt.
   */
  async saveCompletedDetails(
    assignmentId: string,
    status: 'pending' | 'no_email',
    fieldValues: FieldValues,
    db: Db,
  ): Promise<void> {
    const changed = await db.$executeRaw`
      UPDATE assignments
      SET status = ${status}::assignment_status, field_values = ${JSON.stringify(fieldValues)}::jsonb,
          updated_at = now()
      WHERE id = ${assignmentId}::uuid AND status = 'missing_data' AND field_values IS NULL`;
    if (changed !== 1) throw new Error('Assignment changed while sending');
  }

  /** What print and the scanned signature need about one assignment; null when there is none. */
  async documentFacts(assignmentId: string, db: Db = this.prisma): Promise<DocumentFacts | null> {
    const rows = await db.$queryRaw<DocumentFacts[]>`
      SELECT a.id AS "assignmentId", a.round_id AS "roundId", a.status::text AS status,
             a.template_id AS "templateId", a.field_values AS "fieldValues",
             e.first_name AS "firstName", e.last_name AS "lastName",
             e.employee_number AS "employeeNumber", d.code AS "departmentCode",
             r.status::text AS "roundStatus", r.link_expires_at AS "linkExpiresAt", now() AS now
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN employees e ON e.id = a.employee_id
      JOIN departments d ON d.id = a.department_id
      WHERE a.id = ${assignmentId}::uuid`;
    return rows[0] ?? null;
  }

  /** Locks the assignment row (the caller holds the round lock) and reads its status again. */
  async lockStatus(assignmentId: string, db: Db): Promise<AssignmentStatus | null> {
    return (await this.lockState(assignmentId, db))?.status ?? null;
  }

  /** Like `lockStatus`, with the 5-attempt lock flag (the office kiosk needs both). */
  async lockState(
    assignmentId: string,
    db: Db,
  ): Promise<{ status: AssignmentStatus; locked: boolean } | null> {
    const rows = await db.$queryRaw<{ status: AssignmentStatus; locked: boolean }[]>`
      SELECT status::text AS status, locked_at IS NOT NULL AS locked
      FROM assignments WHERE id = ${assignmentId}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * "Signed manually" (FR-MAN-3): the scan's key and SHA-256, the time, the manager who handled
   * it; no IP or browser of a signer, no answers, never waiting for approval. Only from an open
   * status with saved values (the caller holds the row lock and checked); throws otherwise.
   */
  async markSignedManual(write: ManualSignedWrite, db: Db): Promise<Date> {
    const rows = await db.$queryRaw<{ signedAt: Date }[]>`
      UPDATE assignments
      SET status = 'signed_manual', signed_at = now(), sign_method = 'manual',
          signed_file_key = ${write.fileKey}, signed_file_sha256 = ${write.fileSha256},
          handled_by = ${write.handledById}::uuid, needs_approval = false, updated_at = now()
      WHERE id = ${write.assignmentId}::uuid
        AND status::text = ANY(${[...MANUAL_PRINTABLE_STATUSES]}::text[])
      RETURNING signed_at AS "signedAt"`;
    const [row] = rows;
    if (!row) throw new Error('Assignment changed while signing manually');
    return row.signedAt;
  }

  /** Ends every signing session of the assignment: an open session can't submit any more. */
  async deleteSessions(assignmentId: string, db: Db): Promise<void> {
    await db.signingSession.deleteMany({ where: { assignmentId } });
  }
}
