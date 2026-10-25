import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/config.schema.js';
import { EmailAdapter } from './email.adapter.js';
import { EmailService } from './email.service.js';
import { SmtpEmailAdapter } from './smtp-email.adapter.js';
import { DisabledEmailWebhookAdapter } from './webhook/disabled-email-webhook.adapter.js';
import { EmailWebhookAdapter } from './webhook/email-webhook.adapter.js';
import { TestEmailWebhookAdapter } from './webhook/test-email-webhook.adapter.js';

/**
 * The provider's notices (3.15): the test stub, or nothing (every notice refused). The config
 * already refuses the stub in production; checked again here so it can never be wired there.
 */
export function emailWebhookAdapter({ nodeEnv, emailWebhook }: AppConfig): EmailWebhookAdapter {
  const { provider, secret } = emailWebhook;
  if (provider === undefined || secret === undefined) return new DisabledEmailWebhookAdapter();
  if (nodeEnv === 'production') {
    throw new Error('EMAIL_WEBHOOK_PROVIDER=test is refused in production');
  }
  return new TestEmailWebhookAdapter(secret);
}

/** Email. SES or Postmark later (task 7.5) = another EmailAdapter and EmailWebhookAdapter here. */
@Global()
@Module({
  providers: [
    { provide: EmailAdapter, useClass: SmtpEmailAdapter },
    { provide: EmailWebhookAdapter, useFactory: emailWebhookAdapter, inject: [AppConfig] },
    EmailService,
  ],
  exports: [EmailAdapter, EmailWebhookAdapter, EmailService],
})
export class EmailModule {}
