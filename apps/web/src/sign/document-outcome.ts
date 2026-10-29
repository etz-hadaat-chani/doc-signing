import { isApiRequestError } from '../api/api-error';
import { verifyOutcome, type VerifyOutcome } from './id-check-outcome';

/**
 * What a failed `GET …/document` (link or office computer) means for B2:
 * - `sessionEnded`: 401 `SIGN_SESSION_EXPIRED`, the 15 minutes are over (or the browser closed);
 * - `refused` / `gone`: as at the ID check (409 with a state, 423, 404): the B5 screen;
 * - `wait`: 429, try again after `seconds` (null: no `Retry-After`, `message` is the shared text);
 * - `failed`: no connection or anything else: "try again".
 */
export type DocumentOutcome =
  | { kind: 'sessionEnded' }
  | Exclude<VerifyOutcome, { kind: 'retry' }>
  | { kind: 'wait'; seconds: number | null; message: string }
  | { kind: 'failed' };

export function documentOutcome(error: unknown): DocumentOutcome {
  if (!isApiRequestError(error) || error.kind !== 'api') return { kind: 'failed' };
  if (error.code === 'SIGN_SESSION_EXPIRED') return { kind: 'sessionEnded' };
  if (error.status === 429) {
    return { kind: 'wait', seconds: error.retryAfterSeconds, message: error.message };
  }
  const outcome = verifyOutcome(error);
  return outcome.kind === 'retry' ? { kind: 'failed' } : outcome;
}
