import { errorMessage, type SignLinkState } from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../api/api-error';
import { he } from '../i18n/he';

const text = he.sign.idCheck;

export type RefusedState = Exclude<SignLinkState, 'valid'>;

/**
 * What a failed `verify` (link or office computer) means for B1:
 * - `retry`: stay on the ID field with this line (and wait `waitSeconds` first, for a 429);
 * - `refused`: the link can't be signed (any more): the B5 screen of that state;
 * - `gone`: the office computer's code ended (404); for a link, "not valid".
 */
export type VerifyOutcome =
  | { kind: 'retry'; message: string; waitSeconds?: number }
  | { kind: 'refused'; state: RefusedState }
  | { kind: 'gone' };

const attemptsSchema = z.object({ attemptsLeft: z.number().int().positive() });
const stateSchema = z.object({
  state: z.enum(['signed', 'cancelled', 'expired', 'locked']) satisfies z.ZodType<RefusedState>,
});

/** Every answer of `POST …/verify` but 200, as B1 shows it. Pure; the field is emptied anyway. */
export function verifyOutcome(error: unknown): VerifyOutcome {
  if (!isApiRequestError(error)) return { kind: 'retry', message: he.feedback.crashText };
  if (error.kind !== 'api') return { kind: 'retry', message: error.message };
  const { status, code } = error;
  if (status === 423) return { kind: 'refused', state: 'locked' };
  if (status === 404) return { kind: 'gone' };
  if (status === 409) {
    const refused = stateSchema.safeParse(error.details);
    if (refused.success) return { kind: 'refused', state: refused.data.state };
    return { kind: 'retry', message: error.message };
  }
  if (code === 'SIGN_ID_MISMATCH') {
    const attempts = attemptsSchema.safeParse(error.details);
    if (!attempts.success) return { kind: 'retry', message: errorMessage(code) };
    return { kind: 'retry', message: text.mismatch(attempts.data.attemptsLeft) };
  }
  if (status === 400) return { kind: 'retry', message: text.invalid };
  if (status === 429) {
    const seconds = error.retryAfterSeconds;
    if (seconds === null) return { kind: 'retry', message: error.message };
    return { kind: 'retry', message: text.wait(Math.ceil(seconds / 60)), waitSeconds: seconds };
  }
  // 401 SIGN_SESSION_EXPIRED (6.3 / 6.4 ask again here) and anything else: the shared text.
  return { kind: 'retry', message: error.message };
}
