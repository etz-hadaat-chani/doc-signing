import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signWebhook } from '../../src/common/email/webhook/webhook-signature.js';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { httpServer } from './app.js';

/** The webhook secret of the DB tests (db-setup.ts); made up, never a real one. */
export const TEST_WEBHOOK_SECRET = 'test-only-webhook-secret-not-real-0123456789';

export interface NoticeOptions {
  secret?: string;
  /** When the notice was signed (default now). */
  signedAt?: Date;
  /** Headers instead of the signed ones (e.g. none). */
  headers?: Record<string, string>;
}

/** POSTs a notice with this body to the webhook, signed like the test provider. */
export function postNotice(app: INestApplication, body: unknown, options: NoticeOptions = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const rawBody = Buffer.from(text);
  const headers =
    options.headers ??
    signWebhook(options.secret ?? TEST_WEBHOOK_SECRET, rawBody, options.signedAt);
  return (
    request(httpServer(app))
      .post('/api/webhooks/email')
      .set({ 'content-type': 'application/json', ...headers })
      // A string goes as is; supertest would turn a Buffer into JSON.
      .send(text)
  );
}

/** One bounce of the email with this provider id. */
export function postBounce(
  app: INestApplication,
  messageId: string,
  bounceType: 'hard' | 'soft' = 'hard',
  options: NoticeOptions = {},
) {
  return postNotice(app, { events: [{ type: 'bounce', bounceType, messageId }] }, options);
}

/** Gives the email row a provider id (as the email job does when it's sent); returns it. */
export async function withProviderId(
  prisma: PrismaService,
  emailMessageId: string,
): Promise<string> {
  const providerMessageId = `<${emailMessageId}@doc-signing.test>`;
  await prisma.emailMessage.update({ where: { id: emailMessageId }, data: { providerMessageId } });
  return providerMessageId;
}
