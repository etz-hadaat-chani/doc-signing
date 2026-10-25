import {
  type EmailEvent,
  EmailWebhookAdapter,
  WebhookUnauthorizedError,
} from './email-webhook.adapter.js';

/** No provider set up (`EMAIL_WEBHOOK_PROVIDER` empty): every notice is refused. */
export class DisabledEmailWebhookAdapter extends EmailWebhookAdapter {
  parse(): EmailEvent[] {
    throw new WebhookUnauthorizedError();
  }
}
