export interface EmailAddress {
  /** Display name; Hebrew is fine. */
  readonly name: string;
  readonly address: string;
}

export interface EmailAttachment {
  /** Name the employee sees; Hebrew is fine (see `attachmentName`). */
  readonly fileName: string;
  readonly content: Buffer;
  readonly contentType: string;
}

export interface OutgoingEmail {
  /** One plain address, already checked. */
  readonly to: string;
  readonly from: EmailAddress;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments?: readonly EmailAttachment[];
}

export interface SendResult {
  /** The provider's id for the message (SMTP: the Message-ID header), for bounce matching. */
  readonly providerMessageId: string;
}

/**
 * Sends one email. Injected by class: `constructor(private readonly email: EmailAdapter)`.
 * SMTP (Mailpit locally) now; SES or Postmark later (task 7.5) is another class.
 * Failures throw `EmailSendError`. Most code should use `EmailService`, which renders the emails.
 */
export abstract class EmailAdapter {
  abstract send(message: OutgoingEmail): Promise<SendResult>;
}
