import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  type EmailEvent,
  EmailWebhookAdapter,
  type WebhookRequest,
  WebhookUnauthorizedError,
} from '../../common/email/webhook/email-webhook.adapter.js';
import { AppException } from '../../common/errors/app.exception.js';
import { redactForLog } from '../../common/errors/redact.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { EmailBounceRepository, type NoticedEmail } from './email-bounce.repository.js';
import { WebhookRateLimitService } from './webhook-rate-limit.service.js';

const BOUNCE_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

/** The answer to the provider: how many events the notice had. */
export interface WebhookOutcome {
  received: number;
}

/**
 * The provider's notices (3.15, FR-REM-4). Order: per-IP limit → signature (the adapter, before
 * the body is read) → each event. A hard bounce marks the email `bounced`, the employee's email
 * `bounced` (if it is still that address) and her open assignments whose newest link went there
 * `invalid_email`, in one transaction. A soft bounce is only logged. An unknown message id is
 * logged and ignored (200, so the provider doesn't retry it forever). A repeated notice changes
 * nothing.
 */
@Injectable()
export class EmailBounceService {
  private readonly logger = new Logger(EmailBounceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: EmailWebhookAdapter,
    private readonly repository: EmailBounceRepository,
    private readonly rateLimit: WebhookRateLimitService,
    private readonly audit: AuditService,
  ) {}

  async receive(request: WebhookRequest, ip: string | null): Promise<WebhookOutcome> {
    await this.rateLimit.hit(ip);
    const events = this.parse(request);
    for (const event of events) {
      if (event.kind === 'other') continue;
      const emails = await this.repository.findByProviderId(event.providerMessageId);
      if (emails.length === 0) {
        this.logger.warn(
          redactForLog(`Bounce for an unknown message ignored (${event.providerMessageId})`),
        );
        continue;
      }
      for (const email of emails) {
        if (event.kind === 'hard_bounce') await this.hardBounce(email);
        else await this.softBounce(email);
      }
    }
    return { received: events.length };
  }

  private parse(request: WebhookRequest): EmailEvent[] {
    try {
      return this.adapter.parse(request);
    } catch (error) {
      if (error instanceof WebhookUnauthorizedError) {
        throw new AppException('WEBHOOK_UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  private async hardBounce(email: NoticedEmail): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { employeeId, toEmail } = email;
      const affected = await this.repository.affectedAssignments(employeeId, toEmail, tx);
      await this.repository.lockRounds([email.roundId, ...affected.map((a) => a.roundId)], tx);
      await this.repository.lockAssignments([email.assignmentId, ...affected.map((a) => a.id)], tx);
      if (!(await this.repository.markEmailBounced(email.id, tx))) return;
      const employeeMarkedBounced = await this.repository.markEmployeeBounced(
        employeeId,
        toEmail,
        tx,
      );
      const ids = affected.map((a) => a.id);
      const invalidatedAssignmentIds = await this.repository.invalidate(ids, toEmail, tx);
      await this.audit.record(
        {
          actor: { type: 'system' },
          action: 'email.bounced',
          entity: { type: 'assignment', id: email.assignmentId },
          ip: null,
          details: {
            roundId: email.roundId,
            emailMessageId: email.id,
            emailType: email.type,
            employeeMarkedBounced,
            invalidatedAssignmentIds,
          },
        },
        tx,
      );
    }, BOUNCE_TRANSACTION);
  }

  /**
   * Mailbox full, server busy: the provider retries by itself and the next reminder is another
   * try, so nothing changes; logged once per email (a provider that gives up reports a hard
   * bounce).
   */
  private async softBounce(email: NoticedEmail): Promise<void> {
    if (!(await this.repository.isDeliverable(email.id))) return;
    if (await this.repository.softBounceLogged(email.id)) return;
    await this.audit.record({
      actor: { type: 'system' },
      action: 'email.soft_bounced',
      entity: { type: 'assignment', id: email.assignmentId },
      ip: null,
      details: { roundId: email.roundId, emailMessageId: email.id, emailType: email.type },
    });
  }
}
