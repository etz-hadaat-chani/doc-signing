import { Injectable, Logger } from '@nestjs/common';
import type { AuditEntry } from '../../common/audit/audit.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { EmailSendError } from '../../common/email/email.errors.js';
import { EmailService } from '../../common/email/email.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { InvitationJobData } from '../../common/queue/queue.definitions.js';
import type { JobContext } from '../../common/queue/queue.service.js';
import { StorageAdapter } from '../../common/storage/storage.adapter.js';
import { UNCONFIRMED } from '../rounds/signing-email-sender.service.js';
import { type SignedCopyRow, SignedCopyRepository } from './signed-copy.repository.js';

/**
 * `email_messages.error` while a signed copy is being handed to the provider. A signed copy has
 * no token, so this marker plays the part of the invitation's token hash: a retry that finds it
 * knows the email may have left, and never sends it again.
 */
export const SENDING = 'SENDING';

type FailedReason = AuditEntry<'assignment.signed_copy_failed'>['details']['reason'];

/**
 * The signed copy (3.13, FR-SGN-6): runs in the worker for each `SIGNED_COPY_QUEUE` job. Safe to
 * run twice and never sends the copy twice:
 * 1. Not `queued` → nothing. The stored PDF is read first (a missing file is retried).
 * 2. A short transaction locks the row: the marker already set → an earlier attempt handed it
 *    over (or may have) → `sent`, `UNCONFIRMED`; else the marker is set, commit.
 * 3. The email, to `to_email` of the link she signed through (never an address she typed), the
 *    PDF attached as `<document> - <first> <last>.pdf`. Then `sent`.
 * Errors: permanent → `failed` (the assignment stays signed); temporary, maybe sent → `sent`
 * `UNCONFIRMED:<code>`, no retry; temporary, clearly not sent, or before the provider → the
 * marker is cleared and the job retried; the last attempt → `failed`, or `UNCONFIRMED` when the
 * marker is set.
 */
@Injectable()
export class SignedCopySender {
  private readonly logger = new Logger(SignedCopySender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SignedCopyRepository,
    private readonly storage: StorageAdapter,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  async run(job: JobContext<InvitationJobData>): Promise<void> {
    try {
      await this.attempt(job.data.emailMessageId);
    } catch (error) {
      if (job.isLastAttempt) await this.settleLastAttempt(job, error);
      throw error;
    }
  }

  private async attempt(id: string): Promise<void> {
    const copy = await this.repository.find(id);
    if (!copy || copy.status !== 'queued') return;
    if (copy.error === SENDING) {
      await this.settleSent(id, null, UNCONFIRMED);
      return;
    }
    if (!copy.signedFileKey) throw new Error('Signed copy of an assignment without a file');
    const pdf = await this.storage.download(copy.signedFileKey);

    const start = await this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.find(id, tx, true);
      if (!locked || locked.status !== 'queued') return 'skip';
      if (locked.error === SENDING) return 'unconfirmed';
      await this.repository.setError(id, SENDING, tx);
      return 'send';
    });
    if (start === 'skip') return;
    if (start === 'unconfirmed') {
      await this.settleSent(id, null, UNCONFIRMED);
      return;
    }

    let providerMessageId: string;
    try {
      const name = `${copy.firstName.trim()} ${copy.lastName.trim()}`.trim();
      const result = await this.email.sendSignedCopy({
        to: copy.toEmail,
        employeeName: name,
        documentName: copy.documentName,
        pdf,
        fileName: `${copy.documentName} - ${name}`,
      });
      providerMessageId = result.providerMessageId;
    } catch (error) {
      await this.onSendError(id, error);
      return;
    }
    await this.settleSent(id, providerMessageId, null);
  }

  /** A send that threw: settle it, or clear the marker (it never left) and rethrow for a retry. */
  private async onSendError(id: string, error: unknown): Promise<void> {
    if (error instanceof EmailSendError) {
      const code = error.providerCode ?? 'UNKNOWN';
      if (error.kind === 'permanent') {
        await this.settleFailed(id, code, 'permanent');
        return;
      }
      if (error.delivery === 'maybe_sent') {
        await this.settleSent(id, null, `${UNCONFIRMED}:${code}`);
        return;
      }
      await this.repository.setError(id, code);
      throw error;
    }
    await this.repository.setError(id, 'UNEXPECTED');
    throw error;
  }

  /** The last attempt failed: `UNCONFIRMED` if it may have left, else `failed`. Never throws. */
  private async settleLastAttempt(job: JobContext<InvitationJobData>, error: unknown) {
    const temporary = error instanceof EmailSendError;
    const code = temporary ? (error.providerCode ?? 'UNKNOWN') : 'UNEXPECTED';
    const reason: FailedReason = temporary ? 'temporary_last_attempt' : 'unexpected_last_attempt';
    const id = job.data.emailMessageId;
    try {
      const copy = await this.repository.find(id);
      if (copy?.error === SENDING) await this.settleSent(id, null, UNCONFIRMED);
      else await this.settleFailed(id, code, reason);
    } catch (settleError) {
      const name = settleError instanceof Error ? settleError.name : 'unknown error';
      this.logger.error(`Signed copy job ${job.id}: could not settle the last attempt (${name})`);
    }
  }

  private settleSent(id: string, providerMessageId: string | null, error: string | null) {
    return this.settle(id, async (copy, tx) => {
      if (!(await this.repository.settleSent(id, { providerMessageId, error }, tx))) return null;
      return {
        actor: { type: 'system' },
        action: 'assignment.signed_copy_sent',
        entity: { type: 'assignment', id: copy.assignmentId },
        ip: null,
        details: {
          roundId: copy.roundId,
          emailMessageId: id,
          unconfirmed: error !== null,
          providerCode: error?.startsWith(`${UNCONFIRMED}:`)
            ? error.slice(UNCONFIRMED.length + 1)
            : null,
        },
      };
    });
  }

  private settleFailed(id: string, code: string, reason: FailedReason) {
    return this.settle(id, async (copy, tx) => {
      if (!(await this.repository.settleFailed(id, code, tx))) return null;
      return {
        actor: { type: 'system' },
        action: 'assignment.signed_copy_failed',
        entity: { type: 'assignment', id: copy.assignmentId },
        ip: null,
        details: { roundId: copy.roundId, emailMessageId: id, reason, providerCode: code },
      };
    });
  }

  /** Settles the row (locked) and logs it, in one transaction; nothing when not `queued`. */
  private async settle(
    id: string,
    apply: (
      copy: SignedCopyRow,
      tx: Db,
    ) => Promise<
      AuditEntry<'assignment.signed_copy_sent'> | AuditEntry<'assignment.signed_copy_failed'> | null
    >,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const copy = await this.repository.find(id, tx, true);
      if (!copy || copy.status !== 'queued') return;
      const entry = await apply(copy, tx);
      if (entry) await this.audit.record(entry, tx);
    });
  }
}
