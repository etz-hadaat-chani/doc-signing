import { z } from 'zod';
import { signVerifySchema } from './signing.js';

// ---------------------------------------------------------------------------
// Office signing station (3.16 part B, FR-MAN-4): /api/kiosk/*
// ---------------------------------------------------------------------------

/**
 * A kiosk code works this long after the manager opens it, until the correct ID number is
 * typed. Short: the manager opens it with the employee already sitting there, and a code left in
 * an open window or the history stops working soon. After the ID check she has the usual
 * 15-minute signing session (`SIGN_SESSION_MINUTES`).
 */
export const KIOSK_CODE_MINUTES = 10;

/**
 * The office computer's page (5.7, PRD FR-MAN-4): the employee or the manager types the short
 * code there. No staff user is signed in on that computer.
 */
export const KIOSK_PAGE_PATH = '/kiosk';

/**
 * The short code a manager reads off A10 and types on the office computer (5.7): 8 characters
 * from an alphabet without look-alikes (no 0 / O, 1 / I / L). One use, `KIOSK_CODE_MINUTES`,
 * only its SHA-256 stored. `POST /api/kiosk/code` trades it for the long kiosk code.
 */
export const KIOSK_SHORT_CODE_LENGTH = 8;
export const KIOSK_SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** What was typed, as the server compares it: upper case, without spaces and hyphens. */
export function normalizeKioskShortCode(typed: string): string {
  return typed.replace(/[\s-]/g, '').toUpperCase();
}

/** True when a normalized code has the right length and only alphabet characters. */
export function isKioskShortCodeShape(code: string): boolean {
  if (code.length !== KIOSK_SHORT_CODE_LENGTH) return false;
  return [...code].every((char) => KIOSK_SHORT_CODE_ALPHABET.includes(char));
}

/** For reading aloud and typing: two groups of four, `ABCD-EFGH`. */
export function formatKioskShortCode(code: string): string {
  const half = KIOSK_SHORT_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** The code in a request body: never in an address. Its shape is checked by the server. */
const kioskCode = z.string().max(100);

/** `POST /api/kiosk/code` (the short code), `POST /api/kiosk/state` (the long one). */
export const kioskCodeSchema = z.strictObject({ code: kioskCode });
export type KioskCodeInput = z.infer<typeof kioskCodeSchema>;

/** `POST /api/kiosk/verify`: the code and the ID number she types (same check as a link). */
export const kioskVerifySchema = signVerifySchema.extend({ code: kioskCode });
export type KioskVerifyInput = z.infer<typeof kioskVerifySchema>;

/** `POST /api/assignments/:id/kiosk` (201): the short code, shown once in the A10 dialog. */
export const kioskOpenedSchema = z.object({
  assignmentId: z.uuid(),
  /** `KIOSK_SHORT_CODE_LENGTH` characters; stored only as its SHA-256. */
  shortCode: z.string(),
  /** Until when the short code can be typed (the database's clock). */
  expiresAt: z.iso.datetime(),
  /** Where it is typed on the office computer. */
  kioskPath: z.literal(KIOSK_PAGE_PATH),
});
export type KioskOpened = z.infer<typeof kioskOpenedSchema>;

/**
 * `POST /api/kiosk/code` (200): the long kiosk code (43 characters) for `state` / `verify`.
 * The page keeps it in memory only; it works `KIOSK_CODE_MINUTES` from now, until the ID check.
 */
export const kioskCodeEnteredSchema = z.object({ code: z.string() });
export type KioskCodeEntered = z.infer<typeof kioskCodeEnteredSchema>;
