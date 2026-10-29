import { KIOSK_SHORT_CODE_ALPHABET, KIOSK_SHORT_CODE_LENGTH } from '@doc-signing/shared';
import { randomInt } from 'node:crypto';

/**
 * A new office short code (5.7, FR-MAN-4): `KIOSK_SHORT_CODE_LENGTH` characters drawn evenly
 * (`randomInt`, no modulo bias) from the alphabet without look-alikes; about 40 bits. Shown once
 * in the manager's dialog; only its SHA-256 (`hashSigningToken`) is stored. Never logged.
 */
export function newKioskShortCode(): string {
  return Array.from(
    { length: KIOSK_SHORT_CODE_LENGTH },
    () => KIOSK_SHORT_CODE_ALPHABET[randomInt(KIOSK_SHORT_CODE_ALPHABET.length)] ?? '',
  ).join('');
}
