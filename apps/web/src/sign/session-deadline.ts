import { SIGN_SESSION_MINUTES, type SignVerifiedResult } from '@doc-signing/shared';

/** The notice shows this long before the session ends (FR-SGN-8: 15 minutes, fixed). */
export const SESSION_WARNING_MS = 2 * 60_000;

/**
 * When the session ends, on this computer's clock: `sessionExpiresAt` from the correct ID
 * number, as time left from now, never more than the session's length (a clock behind the
 * server's can't push the notice past the real end).
 */
export function sessionDeadline({ sessionExpiresAt }: SignVerifiedResult, now = Date.now()) {
  const left = Date.parse(sessionExpiresAt) - now;
  const most = SIGN_SESSION_MINUTES * 60_000;
  return now + (Number.isFinite(left) ? Math.min(Math.max(left, 0), most) : most);
}
