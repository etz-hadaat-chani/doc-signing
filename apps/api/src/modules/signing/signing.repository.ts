import { type AssignmentStatus, MAX_ID_ATTEMPTS } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { KIOSK_SIGNABLE_STATUSES, type LinkFacts, SIGNABLE_STATUSES } from './link-state.js';

/** A signing link: the invitation or reminder row its token belongs to, with what it opens. */
export interface SigningLink extends LinkFacts {
  emailMessageId: string;
  /** The address this link was sent to: the signed copy goes here (FR-SGN-6). */
  toEmail: string;
  assignmentId: string;
  roundId: string;
}

/** The assignment as a locked verify or submit sees it. */
export interface LockedAssignment extends LinkFacts {
  failedAttempts: number;
  /** The employee's stored ID number (9 digits); only the verify compares it, never returns it. */
  idNumber: string;
}

/** What the document, the form and submit are built from. */
export interface SigningData {
  assignmentId: string;
  roundId: string;
  templateId: string | null;
  /** `assignments.field_values` as stored (checked with `fieldValuesSchema` by the caller). */
  fieldValues: unknown;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  /** The department at send time (`assignments.department_id`), for the file path. */
  departmentCode: number;
  /** The manager's note when this is a correction round (FR-TRK-6), else null. */
  correctionNote: string | null;
}

export interface SignedWrite {
  assignmentId: string;
  /** `digital` by link (3.13), `kiosk` at the office signing station (3.16). */
  signMethod: 'digital' | 'kiosk';
  /** The manager who opened the kiosk; null for a link. */
  handledById: string | null;
  /** The statuses it may be signed from (the caller's state rule). */
  fromStatuses: readonly AssignmentStatus[];
  signedAt: Date;
  fileKey: string;
  fileSha256: string;
  ip: string | null;
  userAgent: string | null;
  needsApproval: boolean;
}

/** One `assignment_responses` row. */
export interface ResponseRow {
  key: string;
  templateFieldId: string | null;
  value: string | null;
  fileKey: string | null;
}

/**
 * The public signing flow's data (3.13): finding a link by its token's hash, the locks, and every
 * change of an assignment's status here (CLAUDE.md layering). Lock order, as in 3.12: the round
 * row first (FOR SHARE here: signings don't wait for each other, a cancel's FOR UPDATE does), then
 * the assignment (FOR UPDATE). Email rows are never locked: only `to_email` is read (it never
 * changes) and the signed-copy row is inserted.
 */
@Injectable()
export class SigningRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The link with this token hash: any invitation or reminder that has one (also `UNCONFIRMED`;
   * a `failed` or `queued` row has none), with the state facts. Null for an unknown token.
   */
  async findLink(tokenHash: string): Promise<SigningLink | null> {
    const rows = await this.prisma.$queryRaw<SigningLink[]>`
      SELECT em.id AS "emailMessageId", em.to_email AS "toEmail",
             a.id AS "assignmentId", a.round_id AS "roundId",
             a.status::text AS status, a.locked_at IS NOT NULL AS locked,
             r.status::text AS "roundStatus", r.link_expires_at AS "linkExpiresAt", now() AS now
      FROM email_messages em
      JOIN assignments a ON a.id = em.assignment_id
      JOIN rounds r ON r.id = a.round_id
      WHERE em.token_hash = ${tokenHash} AND em.type IN ('invite', 'reminder')`;
    return rows[0] ?? null;
  }

  /**
   * Locks the round (FOR SHARE) and the assignment (FOR UPDATE) and reads the facts again, after
   * any cancel, lock or signature that went first.
   */
  async lockForSigning(
    link: Pick<SigningLink, 'roundId' | 'assignmentId'>,
    db: Db,
  ): Promise<LockedAssignment> {
    await db.$queryRaw`SELECT id FROM rounds WHERE id = ${link.roundId}::uuid FOR SHARE`;
    const rows = await db.$queryRaw<LockedAssignment[]>`
      SELECT a.status::text AS status, a.locked_at IS NOT NULL AS locked,
             r.status::text AS "roundStatus", r.link_expires_at AS "linkExpiresAt", now() AS now,
             a.failed_attempts AS "failedAttempts", e.id_number AS "idNumber"
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN employees e ON e.id = a.employee_id
      WHERE a.id = ${link.assignmentId}::uuid
      FOR UPDATE OF a`;
    const [row] = rows;
    if (!row) throw new Error('Signing link without its assignment');
    return row;
  }

  /**
   * One wrong ID number: the count + 1, and the lock at the 5th (FR-SGN-2). Never above 5 (also
   * the database CHECK). Returns the new count.
   */
  async recordWrongAttempt(assignmentId: string, db: Db): Promise<number> {
    const rows = await db.$queryRaw<{ failedAttempts: number }[]>`
      UPDATE assignments
      SET failed_attempts = failed_attempts + 1,
          locked_at = CASE WHEN failed_attempts + 1 >= ${MAX_ID_ATTEMPTS} THEN now() END,
          updated_at = now()
      WHERE id = ${assignmentId}::uuid AND locked_at IS NULL
        AND failed_attempts < ${MAX_ID_ATTEMPTS}
      RETURNING failed_attempts AS "failedAttempts"`;
    const [row] = rows;
    if (!row) throw new Error('Wrong attempt on a locked assignment');
    return row.failedAttempts;
  }

  /**
   * A correct ID number: "Opened" (from `pending`, `sent` or `invalid_email`; `opened` stays),
   * `first_opened_at` the first time only. At the office kiosk a `no_email` row keeps its
   * status (she has no link and stays in manual handling until she signs), but gets
   * `first_opened_at`. The count of wrong attempts stays (only an unlock clears it).
   */
  async markOpened(assignmentId: string, db: Db): Promise<void> {
    await db.$executeRaw`
      UPDATE assignments
      SET status = CASE WHEN status::text = ANY(${[...SIGNABLE_STATUSES]}::text[])
                        THEN 'opened'::assignment_status ELSE status END,
          first_opened_at = coalesce(first_opened_at, now()), updated_at = now()
      WHERE id = ${assignmentId}::uuid
        AND status::text = ANY(${[...KIOSK_SIGNABLE_STATUSES]}::text[])`;
  }

  /** What the document, the form and submit need. */
  async signingData(assignmentId: string, db: Db = this.prisma): Promise<SigningData> {
    const rows = await db.$queryRaw<SigningData[]>`
      SELECT a.id AS "assignmentId", a.round_id AS "roundId", a.template_id AS "templateId",
             a.field_values AS "fieldValues", e.first_name AS "firstName",
             e.last_name AS "lastName", e.employee_number AS "employeeNumber",
             d.code AS "departmentCode", orig.return_note AS "correctionNote"
      FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      JOIN departments d ON d.id = a.department_id
      JOIN rounds r ON r.id = a.round_id
      LEFT JOIN assignments orig ON orig.id = r.correction_of_assignment_id
      WHERE a.id = ${assignmentId}::uuid`;
    const [row] = rows;
    if (!row) throw new Error('Signing data of a missing assignment');
    return row;
  }

  /**
   * Signed (FR-SGN-5, NFR-SIG-2): status, time, method, who handled it (kiosk), the stored file
   * and its hash, IP, user agent, approval flag. Only from one of `fromStatuses` and while not
   * locked (the caller holds the row lock and checked the state); throws otherwise.
   */
  async markSigned(write: SignedWrite, db: Db): Promise<void> {
    const count = await db.$executeRaw`
      UPDATE assignments
      SET status = 'signed', signed_at = ${write.signedAt},
          sign_method = ${write.signMethod}::sign_method, handled_by = ${write.handledById}::uuid,
          signed_file_key = ${write.fileKey}, signed_file_sha256 = ${write.fileSha256},
          signer_ip = ${write.ip}::inet, signer_user_agent = ${write.userAgent},
          needs_approval = ${write.needsApproval}, updated_at = now()
      WHERE id = ${write.assignmentId}::uuid AND locked_at IS NULL
        AND status::text = ANY(${[...write.fromStatuses]}::text[])`;
    if (count !== 1) throw new Error('Assignment changed while signing');
  }

  /** Her answers, one row per key (NFR-SIG-4), in the signing transaction. */
  async insertResponses(assignmentId: string, rows: readonly ResponseRow[], db: Db) {
    if (rows.length === 0) return;
    const data: Prisma.AssignmentResponseCreateManyInput[] = rows.map((row) => ({
      assignmentId,
      ...row,
    }));
    await db.assignmentResponse.createMany({ data });
  }

  /** Ends every signing session of the assignment (after signing nothing more is allowed). */
  async deleteSessions(assignmentId: string, db: Db): Promise<void> {
    await db.signingSession.deleteMany({ where: { assignmentId } });
  }

  /** The signed copy's email row (`queued`), to the address of the link used; returns its id. */
  async createSignedCopyEmail(assignmentId: string, toEmail: string, db: Db): Promise<string> {
    const row = await db.emailMessage.create({
      data: { assignmentId, type: 'signed_copy', toEmail, status: 'queued' },
      select: { id: true },
    });
    return row.id;
  }
}
