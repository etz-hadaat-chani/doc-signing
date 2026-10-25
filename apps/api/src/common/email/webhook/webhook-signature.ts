import { createHmac, timingSafeEqual } from 'node:crypto';

/** Headers of the test provider's notices (3.15), lowercase as Node gives them. */
export const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

/** A notice older (or further in the future) than this is refused: a copied one can't be replayed later. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/;
const TIMESTAMP_PATTERN = /^[0-9]{1,12}$/;

function hmac(secret: string, timestamp: string, rawBody: Buffer): Buffer {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
}

/**
 * The two headers for a notice: `x-webhook-timestamp` (unix seconds) and
 * `x-webhook-signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`. Used by the tests and
 * the `email:bounce` dev command; a real provider (7.5) signs its own way.
 */
export function signWebhook(
  secret: string,
  rawBody: Buffer,
  now: Date = new Date(),
): Record<string, string> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    [WEBHOOK_SIGNATURE_HEADER]: `v1=${hmac(secret, timestamp, rawBody).toString('hex')}`,
  };
}

export interface WebhookSignatureInput {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer;
  now: Date;
}

/**
 * True only for a notice signed with the secret within the last 5 minutes. Missing or badly
 * shaped headers are false. The comparison takes the same time however much matches (two 32-byte
 * digests, `timingSafeEqual`), so the signature can't be guessed byte by byte.
 */
export function verifyWebhookSignature({
  secret,
  timestamp,
  signature,
  rawBody,
  now,
}: WebhookSignatureInput): boolean {
  if (timestamp === undefined || !TIMESTAMP_PATTERN.test(timestamp)) return false;
  const age = Math.floor(now.getTime() / 1000) - Number(timestamp);
  if (Math.abs(age) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const given = SIGNATURE_PATTERN.exec(signature ?? '')?.[1];
  if (given === undefined) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), hmac(secret, timestamp, rawBody));
}
