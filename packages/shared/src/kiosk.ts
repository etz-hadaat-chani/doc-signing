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

/** Where the web app's kiosk page lives; the code follows after `#` (never sent to a server). */
export const KIOSK_PAGE_PATH = '/kiosk';

/** The code in a request body: never in an address. Its shape is checked by the server. */
const kioskCode = z.string().max(100);

/** `POST /api/kiosk/state`. */
export const kioskCodeSchema = z.strictObject({ code: kioskCode });
export type KioskCodeInput = z.infer<typeof kioskCodeSchema>;

/** `POST /api/kiosk/verify`: the code and the ID number she types (same check as a link). */
export const kioskVerifySchema = signVerifySchema.extend({ code: kioskCode });
export type KioskVerifyInput = z.infer<typeof kioskVerifySchema>;

/** `POST /api/assignments/:id/kiosk` (201): the code goes only into the kiosk window. */
export const kioskOpenedSchema = z.object({
  assignmentId: z.uuid(),
  /** 43 characters; shown once, stored only as its SHA-256. */
  code: z.string(),
  expiresAt: z.iso.datetime(),
  /** Open `<kioskPath>#<code>` in a new window. */
  kioskPath: z.literal(KIOSK_PAGE_PATH),
});
export type KioskOpened = z.infer<typeof kioskOpenedSchema>;
