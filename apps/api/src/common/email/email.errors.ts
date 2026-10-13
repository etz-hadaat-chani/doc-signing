/**
 * - `temporary`: worth retrying (server busy, connection, timeout, or our own SMTP setup, such as
 *   a wrong password: not the employee's fault).
 * - `permanent`: retrying won't help (recipient refused, message rejected, bad address). The
 *   caller marks the send as failed.
 */
export type EmailFailureKind = 'temporary' | 'permanent';

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
  ) {
    super(`Email send failed (${kind}${providerCode ? `, ${providerCode}` : ''})`);
    this.name = 'EmailSendError';
  }
}
