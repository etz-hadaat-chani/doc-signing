import { z } from 'zod';
import { RequestValidationException } from '../../errors/app.exception.js';
import {
  type EmailEvent,
  EmailWebhookAdapter,
  headerValue,
  type WebhookRequest,
  WebhookUnauthorizedError,
} from './email-webhook.adapter.js';
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from './webhook-signature.js';

/** At most this many events in one notice. */
export const TEST_WEBHOOK_MAX_EVENTS = 100;

const eventSchema = z.strictObject({
  type: z.enum(['bounce', 'delivery', 'complaint']),
  bounceType: z.enum(['hard', 'soft']).optional(),
  messageId: z.string().min(1).max(255),
});

/** `{ events: [{ type, bounceType?, messageId }] }`; a bounce must say hard or soft. */
export const testWebhookBodySchema = z.strictObject({
  events: z
    .array(
      eventSchema.refine((event) => event.type !== 'bounce' || event.bounceType !== undefined, {
        path: ['bounceType'],
      }),
    )
    .min(1)
    .max(TEST_WEBHOOK_MAX_EVENTS),
});
export type TestWebhookBody = z.infer<typeof testWebhookBodySchema>;

/**
 * The development and test provider (3.15): Mailpit sends no bounces, so the tests and
 * `pnpm email:bounce` send these. Signed with HMAC-SHA256 (`webhook-signature.ts`). Production
 * refuses it (config and EmailModule).
 */
export class TestEmailWebhookAdapter extends EmailWebhookAdapter {
  constructor(private readonly secret: string) {
    super();
  }

  parse({ rawBody, headers, now }: WebhookRequest): EmailEvent[] {
    const signed = verifyWebhookSignature({
      secret: this.secret,
      timestamp: headerValue(headers, WEBHOOK_TIMESTAMP_HEADER),
      signature: headerValue(headers, WEBHOOK_SIGNATURE_HEADER),
      rawBody,
      now,
    });
    if (!signed) throw new WebhookUnauthorizedError();
    const body = testWebhookBodySchema.safeParse(parseJson(rawBody));
    if (!body.success) throw new RequestValidationException(body.error);
    return body.data.events.map(({ type, bounceType, messageId }) => ({
      kind: type !== 'bounce' ? 'other' : bounceType === 'hard' ? 'hard_bounce' : 'soft_bounce',
      providerMessageId: messageId,
    }));
  }
}

/** Not JSON → undefined, which the schema then refuses (400). */
function parseJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}
