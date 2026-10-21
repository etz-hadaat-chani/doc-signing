import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessageType } from '@doc-signing/shared';
import { z } from 'zod';
import { AppConfig } from '../config/config.schema.js';
import { redactForLog } from '../errors/redact.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Db } from '../prisma/prisma.types.js';
import { SettingsService } from '../settings/settings.service.js';
import { attachmentName } from './attachment-name.js';
import { EmailAdapter, type EmailAttachment, type SendResult } from './email.adapter.js';
import { EmailSendError } from './email.errors.js';
import { SendRate } from './send-rate.js';
import { signingLink } from './signing-link.js';
import { renderInvitation } from './templates/invitation.js';
import type { RenderedEmail } from './templates/layout.js';
import { renderReminder } from './templates/reminder.js';
import { renderSignedCopy } from './templates/signed-copy.js';

/** One plain address; a list or "Name <a@b>" could send the email to someone else. */
const recipientSchema = z.email();

export interface SigningEmailInput {
  readonly to: string;
  /** First and last name, as the employee knows it. */
  readonly employeeName: string;
  readonly documentName: string;
  /** This email's own token (raw); only its hash is stored. Never logged. */
  readonly token: string;
  /** The round's link expiry, shown as DD/MM/YYYY; left out when missing. */
  readonly expiresAt?: Date;
}

export interface InvitationEmailInput extends SigningEmailInput {
  /** A correction round (FR-TRK-6): adds the "corrected document" line. Never the note. */
  readonly correction?: boolean;
}

export interface SignedCopyEmailInput {
  readonly to: string;
  readonly employeeName: string;
  readonly documentName: string;
  readonly pdf: Buffer;
  /** Name of the attachment, e.g. `<document> - <first> <last>.pdf`; Hebrew is fine. */
  readonly fileName: string;
}

/**
 * Renders and sends the three emails. Returns the provider's message id (store it in
 * `email_messages` for bounce matching). Throws `EmailSendError`: `temporary` = retry,
 * `permanent` = mark the send as failed; `delivery` says whether it may have left (an adapter
 * error of any other type becomes `maybe_sent`). An error thrown before the adapter is called
 * (rendering, the sender name) is passed on as it is: nothing was sent. Logs only the email type,
 * message id and error kind.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  /** The provider's rate limit, for every email this process sends (3.10). */
  private readonly rate: SendRate;

  constructor(
    private readonly adapter: EmailAdapter,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {
    this.rate = new SendRate(config.email.sendRatePerSecond);
  }

  sendInvitation(input: InvitationEmailInput, db: Db = this.prisma): Promise<SendResult> {
    const rendered = renderInvitation({
      ...this.requestData(input),
      correction: input.correction === true,
    });
    return this.send('invite', input.to, rendered, [], db);
  }

  sendReminder(input: SigningEmailInput, db: Db = this.prisma): Promise<SendResult> {
    return this.send('reminder', input.to, renderReminder(this.requestData(input)), [], db);
  }

  sendSignedCopy(input: SignedCopyEmailInput, db: Db = this.prisma): Promise<SendResult> {
    const rendered = renderSignedCopy({
      employeeName: input.employeeName,
      documentName: input.documentName,
      hrContact: this.config.email.hrContact,
    });
    const attachment: EmailAttachment = {
      fileName: attachmentName(input.fileName),
      content: input.pdf,
      contentType: 'application/pdf',
    };
    return this.send('signed_copy', input.to, rendered, [attachment], db);
  }

  private requestData(input: SigningEmailInput) {
    return {
      employeeName: input.employeeName,
      documentName: input.documentName,
      link: signingLink(this.config.email.publicUrl, input.token),
      expiresAt: input.expiresAt,
      hrContact: this.config.email.hrContact,
    };
  }

  private async send(
    type: EmailMessageType,
    to: string,
    { subject, html, text }: RenderedEmail,
    attachments: readonly EmailAttachment[],
    db: Db,
  ): Promise<SendResult> {
    if (!recipientSchema.safeParse(to).success) {
      this.logger.warn(`Email not sent (${type}): invalid recipient address`);
      throw new EmailSendError('permanent', 'INVALID_ADDRESS', 'not_sent');
    }
    const from = {
      name: await this.settings.getSenderName(db),
      address: this.config.email.fromAddress,
    };
    await this.rate.take();
    try {
      const result = await this.adapter.send({ to, from, subject, html, text, attachments });
      this.logger.log(redactForLog(`Email sent (${type}, ${result.providerMessageId})`));
      return result;
    } catch (error) {
      if (error instanceof EmailSendError) {
        this.logger.warn(redactForLog(`Email not sent (${type}): ${error.message}`));
        throw error;
      }
      const name = error instanceof Error ? error.name : 'unknown error';
      this.logger.error(`Email not sent (${type}): unexpected ${name}`);
      // The adapter broke its contract: whether the message left is unknown.
      throw new EmailSendError('temporary', 'UNEXPECTED', 'maybe_sent');
    }
  }
}
