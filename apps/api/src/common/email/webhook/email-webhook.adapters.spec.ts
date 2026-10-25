import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/config.schema.js';
import { RequestValidationException } from '../../errors/app.exception.js';
import { emailWebhookAdapter } from '../email.module.js';
import { DisabledEmailWebhookAdapter } from './disabled-email-webhook.adapter.js';
import { WebhookUnauthorizedError } from './email-webhook.adapter.js';
import { TEST_WEBHOOK_MAX_EVENTS, TestEmailWebhookAdapter } from './test-email-webhook.adapter.js';
import { signWebhook } from './webhook-signature.js';

const SECRET = 'unit-test-webhook-secret-0123456789abcdef';
const NOW = new Date('2026-10-25T09:00:00Z');
const adapter = new TestEmailWebhookAdapter(SECRET);

/** A notice of this body (an object is sent as JSON), signed with `secret`. */
function notice(body: unknown, secret = SECRET) {
  const rawBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return { rawBody, headers: signWebhook(secret, rawBody, NOW), now: NOW };
}

const bounce = (bounceType: 'hard' | 'soft', messageId = '<m1@doc-signing.local>') => ({
  type: 'bounce',
  bounceType,
  messageId,
});

describe('TestEmailWebhookAdapter', () => {
  it('maps hard and soft bounces and ignores the rest', () => {
    const events = adapter.parse(
      notice({
        events: [
          bounce('hard', '<a@x>'),
          bounce('soft', '<b@x>'),
          { type: 'delivery', messageId: '<c@x>' },
          { type: 'complaint', messageId: '<d@x>' },
        ],
      }),
    );
    expect(events).toEqual([
      { kind: 'hard_bounce', providerMessageId: '<a@x>' },
      { kind: 'soft_bounce', providerMessageId: '<b@x>' },
      { kind: 'other', providerMessageId: '<c@x>' },
      { kind: 'other', providerMessageId: '<d@x>' },
    ]);
  });

  it('checks the signature before reading the body', () => {
    expect(() => adapter.parse(notice('not json', `${SECRET}-other`))).toThrow(
      WebhookUnauthorizedError,
    );
    const { rawBody, now } = notice({ events: [bounce('hard')] });
    expect(() => adapter.parse({ rawBody, headers: {}, now })).toThrow(WebhookUnauthorizedError);
  });

  it('refuses a repeated header as missing', () => {
    const signed = notice({ events: [bounce('hard')] });
    const headers = Object.fromEntries(
      Object.entries(signed.headers).map(([name, value]) => [name, [value, value]]),
    );
    expect(() => adapter.parse({ ...signed, headers })).toThrow(WebhookUnauthorizedError);
  });

  it('a signed body of the wrong shape is a validation error (400)', () => {
    const bad = [
      'not json',
      {},
      { events: [] },
      { events: [{ type: 'bounce', messageId: '<a@x>' }] },
      { events: [{ ...bounce('hard'), extra: 1 }] },
      { events: [{ type: 'open', messageId: '<a@x>' }] },
      { events: [bounce('hard', '')] },
      { events: [bounce('hard', 'x'.repeat(256))] },
      { events: Array.from({ length: TEST_WEBHOOK_MAX_EVENTS + 1 }, () => bounce('hard')) },
    ];
    for (const body of bad) {
      expect(() => adapter.parse(notice(body)), JSON.stringify(body)).toThrow(
        RequestValidationException,
      );
    }
  });
});

describe('emailWebhookAdapter', () => {
  const config = (
    nodeEnv: AppConfig['nodeEnv'],
    provider: 'test' | undefined,
    secret: string | undefined = SECRET,
  ) => ({ nodeEnv, emailWebhook: { provider, secret, rateLimit: 3000 } }) as AppConfig;

  it('no provider: every notice refused', () => {
    const disabled = emailWebhookAdapter(config('development', undefined));
    expect(disabled).toBeInstanceOf(DisabledEmailWebhookAdapter);
    expect(() => disabled.parse(notice({ events: [bounce('hard')] }))).toThrow(
      WebhookUnauthorizedError,
    );
  });

  it('the test provider outside production', () => {
    expect(emailWebhookAdapter(config('development', 'test'))).toBeInstanceOf(
      TestEmailWebhookAdapter,
    );
    expect(emailWebhookAdapter(config('test', 'test'))).toBeInstanceOf(TestEmailWebhookAdapter);
  });

  it('refuses the test provider in production', () => {
    expect(() => emailWebhookAdapter(config('production', 'test'))).toThrow(/production/);
  });
});
