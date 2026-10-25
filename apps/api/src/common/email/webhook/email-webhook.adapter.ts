/**
 * What a notice says about one email, whatever the provider. `hard_bounce`: the address will
 * never work (unknown mailbox or domain, blocked for good). `soft_bounce`: it failed for now
 * (mailbox full, server busy). `other`: deliveries, complaints and the rest (ignored for now).
 */
export interface EmailEvent {
  readonly kind: 'hard_bounce' | 'soft_bounce' | 'other';
  /** The id the provider gave when it accepted the email (`email_messages.provider_message_id`). */
  readonly providerMessageId: string;
}

export interface WebhookRequest {
  /** The body exactly as received; the signature covers these bytes. */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly now: Date;
}

/** The notice isn't from our provider (no, wrong or old signature). Never says which. */
export class WebhookUnauthorizedError extends Error {
  constructor() {
    super('Webhook signature refused');
    this.name = 'WebhookUnauthorizedError';
  }
}

/**
 * Reads the provider's delivery notices (3.15). Injected by class. `parse` checks the signature
 * first and throws `WebhookUnauthorizedError` before reading anything else; a signed body that
 * isn't what the provider sends throws `RequestValidationException` (400). The test stub now;
 * SES or Postmark (task 7.5) is another class that maps its own payload to `EmailEvent`s.
 */
export abstract class EmailWebhookAdapter {
  abstract parse(request: WebhookRequest): EmailEvent[];
}

/** A header's single value; a repeated header counts as missing. */
export function headerValue(headers: WebhookRequest['headers'], name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}
