import {
  type AssignmentStatus,
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  type RoundStatus,
  type SignMethod,
  type TemplateFieldType,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { Prisma } from '../../generated/prisma/client.js';

/** One row of the approvals list, as read (no answer, address or ID number). */
export interface ApprovalListRow {
  assignmentId: string;
  roundId: string;
  roundName: string;
  roundStatus: RoundStatus;
  isCorrection: boolean;
  templateId: string;
  templateName: string;
  templateVersion: number;
  departmentId: string;
  departmentCode: number;
  departmentName: string;
  employeeId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  signedAt: Date;
  signMethod: SignMethod;
}

/** A box marked "needs approval" that an assignment answered. */
export interface ApprovalReason {
  assignmentId: string;
  key: string;
  fieldType: TemplateFieldType;
  label: string | null;
}

/** The facts of one assignment the responses view shows besides the answers. */
export interface ResponsesFacts {
  assignmentId: string;
  roundId: string;
  status: AssignmentStatus;
  needsApproval: boolean;
  approvedAt: Date | null;
  returnedAt: Date | null;
  returnNote: string | null;
}

/** One stored answer with its box (its first position); the email section has no box. */
export interface StoredAnswer {
  key: string;
  value: string | null;
  fileKey: string | null;
  fieldType: TemplateFieldType | null;
  label: string | null;
  needsApproval: boolean;
}

/** An assignment as approve and return see it (locked). */
export interface ApprovalTarget {
  status: AssignmentStatus;
  needsApproval: boolean;
  approved: boolean;
  returned: boolean;
}

/** A returned assignment as "send again" sees it (locked). */
export interface ReturnedTarget {
  status: AssignmentStatus;
  returned: boolean;
  roundName: string;
  templateId: string | null;
  employeeId: string;
  employeeActive: boolean;
  firstName: string;
  lastName: string;
  /** The correction round already made for it, if any. */
  correctionRoundId: string | null;
}

/** "Waiting for approval": signed, an answer needs approval, not approved (partial index). */
const WAITING = Prisma.sql`a.status = 'signed' AND a.needs_approval AND a.approved_at IS NULL`;

/**
 * Approvals (3.16 part B2, FR-TRK-6): the list, the answers, and every status change of approve
 * and return (CLAUDE.md layering). The caller holds the round lock before locking a row here.
 */
@Injectable()
export class ApprovalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of documents waiting for approval, oldest signature first. Two queries. */
  async page(filter: {
    roundId?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<{ rows: ApprovalListRow[]; total: number }> {
    const where = filter.roundId
      ? Prisma.sql`WHERE ${WAITING} AND a.round_id = ${filter.roundId}::uuid`
      : Prisma.sql`WHERE ${WAITING}`;
    const [count] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM assignments a ${where}`;
    const rows = await this.prisma.$queryRaw<ApprovalListRow[]>`
      SELECT a.id AS "assignmentId", r.id AS "roundId", r.name AS "roundName",
             r.status::text AS "roundStatus",
             r.correction_of_assignment_id IS NOT NULL AS "isCorrection",
             t.id AS "templateId", t.name AS "templateName", t.version AS "templateVersion",
             d.id AS "departmentId", d.code AS "departmentCode", d.name AS "departmentName",
             e.id AS "employeeId", e.employee_number AS "employeeNumber",
             e.first_name AS "firstName", e.last_name AS "lastName",
             a.signed_at AS "signedAt", a.sign_method::text AS "signMethod"
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN templates t ON t.id = a.template_id
      JOIN departments d ON d.id = a.department_id
      JOIN employees e ON e.id = a.employee_id
      ${where}
      ORDER BY a.signed_at, a.id
      LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`;
    return { rows, total: count?.total ?? 0 };
  }

  /**
   * The answered boxes marked "needs approval" (any position of the key) of these assignments,
   * in template order (the box's first position). One query for the whole page.
   */
  async reasons(assignmentIds: readonly string[]): Promise<ApprovalReason[]> {
    if (assignmentIds.length === 0) return [];
    return this.prisma.$queryRaw<ApprovalReason[]>`
      SELECT ar.assignment_id AS "assignmentId", ar.key,
             tf.field_type::text AS "fieldType", tf.label
      FROM assignment_responses ar
      JOIN assignments a ON a.id = ar.assignment_id
      JOIN template_fields tf ON tf.id = ar.template_field_id
      WHERE ar.assignment_id = ANY(${[...assignmentIds]}::uuid[])
        AND EXISTS (SELECT 1 FROM template_fields n
                    WHERE n.template_id = a.template_id AND n.key = ar.key AND n.needs_approval)
      ORDER BY ar.assignment_id, tf.sort_order, tf.id`;
  }

  /** The approval and return facts of one assignment; null when there is none. */
  async responsesFacts(assignmentId: string): Promise<ResponsesFacts | null> {
    const rows = await this.prisma.$queryRaw<ResponsesFacts[]>`
      SELECT id AS "assignmentId", round_id AS "roundId", status::text AS status,
             needs_approval AS "needsApproval", approved_at AS "approvedAt",
             returned_at AS "returnedAt", return_note AS "returnNote"
      FROM assignments WHERE id = ${assignmentId}::uuid`;
    return rows[0] ?? null;
  }

  /**
   * Every stored answer of the assignment with its box: the first position's type and label,
   * "needs approval" on any position of the key. Boxes in template order, the email section
   * last (it has no position).
   */
  async answers(assignmentId: string): Promise<StoredAnswer[]> {
    return this.prisma.$queryRaw<StoredAnswer[]>`
      SELECT ar.key, ar.value, ar.file_key AS "fileKey",
             tf.field_type::text AS "fieldType", tf.label,
             coalesce((SELECT bool_or(n.needs_approval) FROM template_fields n
                       WHERE n.template_id = a.template_id AND n.key = ar.key), false)
               AS "needsApproval"
      FROM assignment_responses ar
      JOIN assignments a ON a.id = ar.assignment_id
      LEFT JOIN template_fields tf ON tf.id = ar.template_field_id
      WHERE ar.assignment_id = ${assignmentId}::uuid
      ORDER BY tf.sort_order NULLS LAST, tf.id, ar.key`;
  }

  /**
   * Whether the address she gave differs from the employee's stored email now (trimmed, any
   * case: the part A rule). Never returns the stored address.
   */
  async emailDiffers(assignmentId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ differs: boolean }[]>`
      SELECT lower(btrim(re.value)) IS DISTINCT FROM lower(btrim(e.email)) AS differs
      FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      JOIN assignment_responses rc
        ON rc.assignment_id = a.id AND rc.key = ${EMAIL_CHOICE_KEY} AND rc.value = 'email'
      JOIN assignment_responses re ON re.assignment_id = a.id AND re.key = ${EMAIL_ANSWER_KEY}
      WHERE a.id = ${assignmentId}::uuid`;
    return rows[0]?.differs ?? false;
  }

  /** Locks the assignment (FOR UPDATE) and reads what approve and return check. */
  async lockApprovalTarget(assignmentId: string, db: Db): Promise<ApprovalTarget | null> {
    const rows = await db.$queryRaw<ApprovalTarget[]>`
      SELECT status::text AS status, needs_approval AS "needsApproval",
             approved_at IS NOT NULL AS approved, returned_at IS NOT NULL AS returned
      FROM assignments WHERE id = ${assignmentId}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  /** Approve: only while waiting. The signed file, its key and hash are never touched. */
  async approve(assignmentId: string, userId: string, db: Db): Promise<Date> {
    const rows = await db.$queryRaw<{ approvedAt: Date }[]>`
      UPDATE assignments a
      SET approved_at = now(), approved_by = ${userId}::uuid, updated_at = now()
      WHERE a.id = ${assignmentId}::uuid AND ${WAITING}
      RETURNING approved_at AS "approvedAt"`;
    const [row] = rows;
    if (!row) throw new Error('Assignment changed while approving');
    return row.approvedAt;
  }

  /**
   * Return for correction: only while waiting; `cancelled` with the return columns (the CHECK
   * wants all three on a cancelled row). The signed file stays stored as proof.
   */
  async markReturned(
    write: { assignmentId: string; userId: string; note: string },
    db: Db,
  ): Promise<Date> {
    const rows = await db.$queryRaw<{ returnedAt: Date }[]>`
      UPDATE assignments a
      SET status = 'cancelled', cancelled_at = now(), returned_at = now(),
          returned_by = ${write.userId}::uuid, return_note = ${write.note}, updated_at = now()
      WHERE a.id = ${write.assignmentId}::uuid AND ${WAITING}
      RETURNING returned_at AS "returnedAt"`;
    const [row] = rows;
    if (!row) throw new Error('Assignment changed while returning');
    return row.returnedAt;
  }

  /** Locks the assignment (FOR UPDATE) and reads what "send again" needs. */
  async lockReturnedTarget(assignmentId: string, db: Db): Promise<ReturnedTarget | null> {
    await db.$queryRaw`SELECT id FROM assignments WHERE id = ${assignmentId}::uuid FOR UPDATE`;
    const rows = await db.$queryRaw<ReturnedTarget[]>`
      SELECT a.status::text AS status, a.returned_at IS NOT NULL AS returned,
             r.name AS "roundName", a.template_id AS "templateId",
             e.id AS "employeeId", e.is_active AS "employeeActive",
             e.first_name AS "firstName", e.last_name AS "lastName",
             cr.id AS "correctionRoundId"
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN rounds cr ON cr.correction_of_assignment_id = a.id
      WHERE a.id = ${assignmentId}::uuid`;
    return rows[0] ?? null;
  }

  /**
   * The newest version of a template: follow `parent_template_id` children to the end (each
   * version has at most one child, UNIQUE). Archived or not, the caller decides.
   */
  async newestVersionOf(templateId: string, db: Db): Promise<string> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE chain AS (
        SELECT id, 0 AS depth FROM templates WHERE id = ${templateId}::uuid
        UNION ALL
        SELECT t.id, c.depth + 1 FROM templates t JOIN chain c ON t.parent_template_id = c.id
      )
      SELECT id FROM chain ORDER BY depth DESC LIMIT 1`;
    const [row] = rows;
    if (!row) throw new Error(`Template ${templateId} not found`);
    return row.id;
  }

  /** The correction round made for a returned assignment, if any (no lock). */
  async correctionRoundOf(assignmentId: string): Promise<string | null> {
    const row = await this.prisma.round.findUnique({
      where: { correctionOfAssignmentId: assignmentId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** The employee's row in a round (the correction round has exactly one). */
  async onlyAssignment(roundId: string, db: Db): Promise<{ id: string; status: AssignmentStatus }> {
    const rows = await db.$queryRaw<{ id: string; status: AssignmentStatus }[]>`
      SELECT id, status::text AS status FROM assignments WHERE round_id = ${roundId}::uuid`;
    const [row] = rows;
    if (!row || rows.length !== 1) throw new Error(`Round ${roundId} should have one assignment`);
    return row;
  }
}
