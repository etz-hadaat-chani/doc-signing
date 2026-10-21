import { createHash, randomBytes } from 'node:crypto';

/**
 * A new signing-link token (NFR-SEC-1): 256 random bits as base64url, 43 characters. One per
 * email (invitation and each reminder). The raw token goes only into the email itself: never
 * into the database, a job's data or a log.
 */
export function newSigningToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What `email_messages.token_hash` stores: the token's SHA-256, 64 hex characters. */
export function hashSigningToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
