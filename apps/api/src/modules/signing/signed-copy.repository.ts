import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';

/** One signed-copy email with what the email needs. */
export interface SignedCopyRow {
  id: string;
  status: string;
  error: string | null;
  toEmail: string;
  assignmentId: string;
  roundId: string;
  signedFileKey: string | null;
  firstName: string;
  lastName: string;
  documentName: string;
}

/** The signed-copy email rows (3.13); only `queued` rows ever change. */
@Injectable()
export class SignedCopyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The row (locked FOR UPDATE when `lock`), or null. */
  async find(id: string, db: Db = this.prisma, lock = false): Promise<SignedCopyRow | null> {
    const rows = lock
      ? await db.$queryRaw<SignedCopyRow[]>`
          SELECT em.id, em.status::text AS status, em.error, em.to_email AS "toEmail",
                 a.id AS "assignmentId", a.round_id AS "roundId",
                 a.signed_file_key AS "signedFileKey", e.first_name AS "firstName",
                 e.last_name AS "lastName", t.name AS "documentName"
          FROM email_messages em
          JOIN assignments a ON a.id = em.assignment_id
          JOIN employees e ON e.id = a.employee_id
          JOIN templates t ON t.id = a.template_id
          WHERE em.id = ${id}::uuid AND em.type = 'signed_copy'
          FOR UPDATE OF em`
      : await db.$queryRaw<SignedCopyRow[]>`
          SELECT em.id, em.status::text AS status, em.error, em.to_email AS "toEmail",
                 a.id AS "assignmentId", a.round_id AS "roundId",
                 a.signed_file_key AS "signedFileKey", e.first_name AS "firstName",
                 e.last_name AS "lastName", t.name AS "documentName"
          FROM email_messages em
          JOIN assignments a ON a.id = em.assignment_id
          JOIN employees e ON e.id = a.employee_id
          JOIN templates t ON t.id = a.template_id
          WHERE em.id = ${id}::uuid AND em.type = 'signed_copy'`;
    return rows[0] ?? null;
  }

  /** Sets `error` of a still-queued row (the "sending" marker, or a code before a retry). */
  async setError(id: string, error: string | null, db: Db = this.prisma): Promise<void> {
    await db.emailMessage.updateMany({ where: { id, status: 'queued' }, data: { error } });
  }

  /** `sent` (or `sent` + `UNCONFIRMED…`); false when it was no longer queued. */
  async settleSent(
    id: string,
    result: { providerMessageId: string | null; error: string | null },
    db: Db,
  ): Promise<boolean> {
    const { count } = await db.emailMessage.updateMany({
      where: { id, status: 'queued' },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        error: result.error,
      },
    });
    return count === 1;
  }

  /** `failed` with the provider's code; the assignment stays signed. */
  async settleFailed(id: string, error: string, db: Db): Promise<boolean> {
    const { count } = await db.emailMessage.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'failed', error },
    });
    return count === 1;
  }
}
