/**
 * - `temporary`: worth retrying (server busy, connection, timeout, or our own SMTP setup, such as
 *   a wrong password: not the employee's fault).
 * - `permanent`: retrying won't help (recipient refused, message rejected, bad address). The
 *   caller marks the send as failed.
 */
export type EmailFailureKind = 'temporary' | 'permanent';

/**
 * Whether the message may have reached the provider (3.10):
 * - `not_sent`: it clearly never left, e.g. the server refused it out loud, or the connection,
 *   login or envelope failed before the message itself was handed over. A retry with a new link
 *   is safe: the old link was never seen.
 * - `maybe_sent`: unclear, e.g. a timeout or a dropped connection while (or after) the message
 *   was handed over. The caller must not send it again (that would be a second, different link).
 */
export type EmailDelivery = 'not_sent' | 'maybe_sent';

/**
 * A send that failed. The message names only the kind and the provider's code: never the
 * recipient, subject or link. The provider's error isn't kept as `cause`, since its text can
 * quote the recipient's address.
 */
export class EmailSendError extends Error {
  constructor(
    readonly kind: EmailFailureKind,
    /** The provider's code, e.g. SMTP `550` or `ECONNECTION`. */
    readonly providerCode: string | undefined,
    /** Required, so an adapter always decides it (a permanent failure is a refusal: not_sent). */
    readonly delivery: EmailDelivery,
  ) {
    super(`Email send failed (${kind}${providerCode ? `, ${providerCode}` : ''})`);
    this.name = 'EmailSendError';
  }
}
