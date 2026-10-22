import { createHash, timingSafeEqual } from 'node:crypto';
import { isValidIdNumber, normalizeIdNumber } from '@doc-signing/shared';

/**
 * The ID number as typed → 9 digits (leading zeros put back), or null when it can't be one:
 * not 1–9 digits, or a wrong check digit. Such a typo is answered 400 and not counted against
 * the 5 attempts (the check-digit rule is public, so it tells nobody anything).
 */
export function typedIdNumber(typed: string): string | null {
  const id = normalizeIdNumber(typed);
  return id !== null && isValidIdNumber(id) ? id : null;
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Compares the typed ID number with the stored one in constant time (NFR-SEC-3): both are hashed
 * first, so the two buffers always have the same length and the time says nothing about where
 * they differ.
 */
export function idNumbersMatch(typed: string, stored: string): boolean {
  const storedId = normalizeIdNumber(stored) ?? stored;
  return timingSafeEqual(digest(typed), digest(storedId));
}
