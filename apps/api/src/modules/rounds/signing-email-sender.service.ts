import { Injectable, Logger } from '@nestjs/common';
import type { AuditEntry } from '../../common/audit/audit.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { EmailSendError } from '../../common/email/email.errors.js';
import { EmailService } from '../../common/email/email.service.js';
import { hashSigningToken, newSigningToken } from '../../common/email/signing-token.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { InvitationJobData } from '../../common/queue/queue.definitions.js';
import type { JobContext } from '../../common/queue/queue.service.js';
import { type LockedInvite, RoundSendRepository } from './round-send.repository.js';

/** Stored in `email_messages.error` when the email may have gone out but wasn't confirmed. */
export const UNCONFIRMED = 'UNCONFIRMED';

type SentAction = 'assignment.invite_sent' | 'assignment.reminder_sent';
type FailedAction = 'assignment.invite_failed' | 'assignment.reminder_failed';
type InviteAudit = AuditEntry<SentAction> | AuditEntry<FailedAction>;

/** What the first short transaction found. */
type Start =
  | { kind: 'skip' }
  | { kind: 'closed'; invite: LockedInvite }
  | { kind: 'unconfirmed'; invite: LockedInvite }
  | { kind: 'send'; invite: LockedInvite; token: string };

/**
 * One invitation (3.10) or reminder (3.12, 3.14): runs in the worker for each
 * `INVITATION_QUEUE` and `REMINDER_QUEUE` job. Safe to run twice and never sends one link twice:
 * 1. A short transaction locks the row. Already settled → nothing. The email may no longer go
 *    (`mayStillGo`: an invitation needs a `pending` assignment; a reminder a `sent` / `opened`
 *    one, not locked, in a sending or active round whose link hasn't expired) → `failed`
 *    `ASSIGNMENT_CLOSED`, nothing sent. A token hash already
 *    stored → an earlier attempt handed the email over (or may have) and then stopped → `sent`,
 *    `UNCONFIRMED`, not sent again. Otherwise a new token: only its hash is stored, then commit.
 * 2. The email, with the raw token (only ever in this variable and the email itself).
 * 3. Settling (round row locked first): `sent`; an invitation's assignment `pending` → `sent`,
 *    a reminder's `reminder_count` + 1; the round `active` once nothing is queued.
 * Errors: permanent → `failed`, assignment `invalid_email`. Temporary, maybe sent → `sent`,
 * `UNCONFIRMED:<code>` (no retry; the reminder is the backstop). Temporary, clearly not sent, or
 * any error before the provider was called → the hash is cleared and the job retried; on its
 * last attempt → `failed`, the assignment stays `pending` ("send failed"). An error after the
 * email went out (saving the result) → retried, and the retry finds the hash: `UNCONFIRMED`.
 */
@Injectable()
export class SigningEmailSender {
  private readonly logger = new Logger(SigningEmailSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RoundSendRepository,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  async run(job: JobContext<InvitationJobData>): Promise<void> {
    try {
      await this.attempt(job);
    } catch (error) {
      if (job.isLastAttempt) await this.settleLastAttempt(job, error);
      throw error;
    }
  }

  private async attempt(job: JobContext<InvitationJobData>): Promise<void> {
    const { emailMessageId } = job.data;
    const start = await this.prisma.$transaction((tx) => this.start(emailMessageId, tx));
    if (start.kind === 'skip') return;
    const { invite } = start;
    if (start.kind === 'closed') {
      await this.settleFailed(invite.id, 'ASSIGNMENT_CLOSED', 'assignment_closed', false);
      return;
    }
    if (start.kind === 'unconfirmed') {
      await this.settleSent(invite.id, null, UNCONFIRMED);
      return;
    }

    let providerMessageId: string;
    try {
      const input = {
        to: invite.toEmail,
        employeeName: `${invite.firstName.trim()} ${invite.lastName.trim()}`.trim(),
        documentName: invite.documentName,
        token: start.token,
        ...(invite.linkExpiresAt && { expiresAt: invite.linkExpiresAt }),
      };
      const result =
        invite.type === 'reminder'
          ? await this.email.sendReminder(input)
          : await this.email.sendInvitation({ ...input, correction: invite.correction });
      providerMessageId = result.providerMessageId;
    } catch (error) {
      await this.onSendError(invite, error);
      return;
    }
    // If saving fails now, the retry finds the hash and settles it as UNCONFIRMED.
    await this.settleSent(invite.id, providerMessageId, null);
  }

  /** Step 1 (one transaction): decide, and store the new token's hash before sending. */
  private async start(emailMessageId: string, tx: Db): Promise<Start> {
    const invite = await this.repository.lockInvite(emailMessageId, tx);
    if (!invite || invite.status !== 'queued') return { kind: 'skip' };
    if (!mayStillGo(invite)) return { kind: 'closed', invite };
    if (invite.hasToken) return { kind: 'unconfirmed', invite };
    const token = newSigningToken();
    await this.repository.setTokenHash(invite.id, hashSigningToken(token), null, tx);
    return { kind: 'send', invite, token };
  }

  /** A send that threw: settle it, or clear the hash (it never left) and rethrow for a retry. */
  private async onSendError(invite: LockedInvite, error: unknown): Promise<void> {
    if (error instanceof EmailSendError) {
      const code = error.providerCode ?? 'UNKNOWN';
      if (error.kind === 'permanent') {
        await this.settleFailed(invite.id, code, 'permanent', true);
        return;
      }
      if (error.delivery === 'maybe_sent') {
        await this.settleSent(invite.id, null, `${UNCONFIRMED}:${code}`);
        return;
      }
      await this.repository.setTokenHash(invite.id, null, code, this.prisma);
      throw error;
    }
    // Thrown before the provider was called (EmailService wraps every adapter error).
    await this.repository.setTokenHash(invite.id, null, 'UNEXPECTED', this.prisma);
    throw error;
  }

  /**
   * The last attempt failed: settle the row so the round can finish. A stored hash means the
   * email was handed over → `sent`, `UNCONFIRMED`; no hash → it never left → `failed`, the
   * assignment stays `pending`. Never fails itself: the job's own error is what is reported.
   */
  private async settleLastAttempt(
    job: JobContext<InvitationJobData>,
    error: unknown,
  ): Promise<void> {
    const temporary = error instanceof EmailSendError;
    const code = temporary ? (error.providerCode ?? 'UNKNOWN') : 'UNEXPECTED';
    const reason = temporary ? 'temporary_last_attempt' : 'unexpected_last_attempt';
    try {
      await this.settle(job.data.emailMessageId, async (invite, tx) => {
        if (invite.hasToken) return this.sentEntry(invite, null, UNCONFIRMED, tx);
        return this.failedEntry(invite, code, reason, false, tx);
      });
    } catch (settleError) {
      const name = settleError instanceof Error ? settleError.name : 'unknown error';
      this.logger.error(`Invitation job ${job.id}: could not settle the last attempt (${name})`);
    }
  }

  private settleSent(id: string, providerMessageId: string | null, error: string | null) {
    return this.settle(id, (invite, tx) => this.sentEntry(invite, providerMessageId, error, tx));
  }

  private settleFailed(
    id: string,
    error: string,
    reason: AuditEntry<'assignment.invite_failed'>['details']['reason'],
    invalidEmail: boolean,
  ) {
    return this.settle(id, (invite, tx) =>
      this.failedEntry(invite, error, reason, invalidEmail, tx),
    );
  }

  private async sentEntry(
    invite: LockedInvite,
    providerMessageId: string | null,
    error: string | null,
    tx: Db,
  ): Promise<InviteAudit | null> {
    if (!(await this.repository.settleSent(invite, { providerMessageId, error }, tx))) return null;
    return {
      actor: { type: 'system' },
      action: invite.type === 'reminder' ? 'assignment.reminder_sent' : 'assignment.invite_sent',
      entity: { type: 'assignment', id: invite.assignmentId },
      ip: null,
      details: {
        roundId: invite.roundId,
        emailMessageId: invite.id,
        unconfirmed: error !== null,
        providerCode: error?.startsWith(`${UNCONFIRMED}:`)
          ? error.slice(UNCONFIRMED.length + 1)
          : null,
      },
    };
  }

  private async failedEntry(
    invite: LockedInvite,
    error: string,
    reason: AuditEntry<'assignment.invite_failed'>['details']['reason'],
    invalidEmail: boolean,
    tx: Db,
  ): Promise<InviteAudit | null> {
    if (!(await this.repository.settleFailed(invite, { error, invalidEmail }, tx))) return null;
    return {
      actor: { type: 'system' },
      action:
        invite.type === 'reminder' ? 'assignment.reminder_failed' : 'assignment.invite_failed',
      entity: { type: 'assignment', id: invite.assignmentId },
      ip: null,
      details: {
        roundId: invite.roundId,
        emailMessageId: invite.id,
        reason,
        providerCode: reason === 'assignment_closed' ? null : error,
      },
    };
  }

  /**
   * Settles one invitation in one transaction, round row locked first (the send's order), then
   * the row; nothing when it is no longer `queued`. Then the round becomes `active` if this was
   * its last queued invitation.
   */
  private async settle(
    emailMessageId: string,
    apply: (invite: LockedInvite, tx: Db) => Promise<InviteAudit | null>,
  ): Promise<void> {
    const finished = await this.prisma.$transaction(async (tx) => {
      const roundId = await this.repository.roundOfInvite(emailMessageId, tx);
      if (!roundId) return null;
      await this.repository.lockRoundForSettle(roundId, tx);
      const invite = await this.repository.lockInvite(emailMessageId, tx);
      if (!invite || invite.status !== 'queued') return null;
      const entry = await apply(invite, tx);
      if (entry) await this.audit.record(entry, tx);
      const progress = await this.repository.finishIfDone(roundId, tx);
      if (!progress) return null;
      await this.audit.record(
        {
          actor: { type: 'system' },
          action: 'round.sending_finished',
          entity: { type: 'round', id: roundId },
          ip: null,
          details: { sent: progress.sent, failed: progress.failed },
        },
        tx,
      );
      return { roundId, ...progress };
    });
    if (finished) {
      this.logger.log(
        `Round ${finished.roundId} active: sent ${String(finished.sent)}, ` +
          `failed ${String(finished.failed)}`,
      );
    }
  }
}

/**
 * Whether the email may still go when its job runs. An invitation: the assignment is still
 * `pending` (not cancelled or signed meanwhile). A reminder: still `sent` / `opened`, not
 * locked, its round sending or active, and the link not expired (it would carry a dead link).
 */
function mayStillGo(invite: LockedInvite): boolean {
  if (invite.type === 'invite') return invite.assignmentStatus === 'pending';
  return (
    (invite.assignmentStatus === 'sent' || invite.assignmentStatus === 'opened') &&
    !invite.locked &&
    (invite.roundStatus === 'sending' || invite.roundStatus === 'active') &&
    !invite.expired
  );
}
