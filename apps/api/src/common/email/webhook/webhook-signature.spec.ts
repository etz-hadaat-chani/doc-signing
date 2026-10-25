import { describe, expect, it, vi } from 'vitest';
import {
  signWebhook,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
} from './webhook-signature.js';

// The real timingSafeEqual, watched, to prove the compare goes through it.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { timingSafeEqual } = await import('node:crypto');

const SECRET = 'unit-test-webhook-secret-0123456789abcdef';
const NOW = new Date('2026-10-25T09:00:00Z');
const BODY = Buffer.from('{"events":[{"type":"bounce","bounceType":"hard","messageId":"<a@b>"}]}');

function input(over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  const headers = signWebhook(SECRET, BODY, NOW);
  return {
    secret: SECRET,
    timestamp: headers[WEBHOOK_TIMESTAMP_HEADER],
    signature: headers[WEBHOOK_SIGNATURE_HEADER],
    rawBody: BODY,
    now: NOW,
    ...over,
  };
}

const secondsLater = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe('verifyWebhookSignature', () => {
  it('accepts a notice signed with the secret', () => {
    expect(verifyWebhookSignature(input())).toBe(true);
    expect(signWebhook(SECRET, BODY, NOW)[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it('refuses another secret or a changed body', () => {
    expect(verifyWebhookSignature(input({ secret: `${SECRET}x` }))).toBe(false);
    expect(verifyWebhookSignature(input({ rawBody: Buffer.from(`${BODY.toString()} `) }))).toBe(
      false,
    );
  });

  it('refuses a changed timestamp (it is signed too)', () => {
    const timestamp = String(Math.floor(NOW.getTime() / 1000) - 1);
    expect(verifyWebhookSignature(input({ timestamp }))).toBe(false);
  });

  it('accepts up to 5 minutes old or ahead, refuses older or further ahead (replay)', () => {
    const limit = WEBHOOK_TOLERANCE_SECONDS;
    expect(verifyWebhookSignature(input({ now: secondsLater(limit) }))).toBe(true);
    expect(verifyWebhookSignature(input({ now: secondsLater(limit + 1) }))).toBe(false);
    expect(verifyWebhookSignature(input({ now: secondsLater(-limit) }))).toBe(true);
    expect(verifyWebhookSignature(input({ now: secondsLater(-limit - 1) }))).toBe(false);
    expect(verifyWebhookSignature(input({ now: secondsLater(24 * 60 * 60) }))).toBe(false);
  });

  it('refuses missing headers', () => {
    expect(verifyWebhookSignature(input({ signature: undefined }))).toBe(false);
    expect(verifyWebhookSignature(input({ timestamp: undefined }))).toBe(false);
    expect(verifyWebhookSignature(input({ signature: '', timestamp: '' }))).toBe(false);
  });

  it('refuses badly shaped headers without throwing', () => {
    const { signature = '' } = input();
    const hex = signature.slice(3);
    for (const bad of [
      hex,
      `v2=${hex}`,
      `v1=${hex.slice(1)}`,
      `v1=${hex}0`,
      `v1=${hex.toUpperCase()}`,
    ]) {
      expect(verifyWebhookSignature(input({ signature: bad }))).toBe(false);
    }
    for (const bad of ['abc', '-1', '1.5', '1e9', '9'.repeat(13)]) {
      expect(verifyWebhookSignature(input({ timestamp: bad }))).toBe(false);
    }
  });

  it('compares in constant time on two 32-byte digests', () => {
    const spy = vi.mocked(timingSafeEqual);
    spy.mockClear();
    const { signature = '' } = input();
    const wrong = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0');
    verifyWebhookSignature(input({ signature: wrong }));
    expect(spy).toHaveBeenCalledTimes(1);
    const [a, b] = spy.mock.calls[0] ?? [];
    expect((a as Buffer).length).toBe(32);
    expect((b as Buffer).length).toBe(32);
  });
});
