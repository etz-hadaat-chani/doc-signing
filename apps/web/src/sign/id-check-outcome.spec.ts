import { errorMessage, type ErrorCode } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/api-error';
import { he } from '../i18n/he';
import { verifyOutcome } from './id-check-outcome';

const text = he.sign.idCheck;

const api = (
  status: number,
  code: ErrorCode,
  details?: Record<string, unknown>,
  retryAfterSeconds?: number,
) => new ApiRequestError({ kind: 'api', status, code, details, retryAfterSeconds });

describe('verifyOutcome (B1)', () => {
  it('a wrong number: the attempts left, one in the singular', () => {
    expect(verifyOutcome(api(401, 'SIGN_ID_MISMATCH', { attemptsLeft: 3 }))).toEqual({
      kind: 'retry',
      message: text.mismatch(3),
    });
    expect(text.mismatch(1)).not.toBe(text.mismatch(2));
    expect(verifyOutcome(api(401, 'SIGN_ID_MISMATCH'))).toEqual({
      kind: 'retry',
      message: errorMessage('SIGN_ID_MISMATCH'),
    });
  });

  it('423 is the locked page; a 409 with a state is that state; 404 is "gone"', () => {
    expect(verifyOutcome(api(423, 'SIGN_LOCKED', { state: 'locked' }))).toEqual({
      kind: 'refused',
      state: 'locked',
    });
    for (const [code, state] of [
      ['SIGN_ALREADY_SIGNED', 'signed'],
      ['SIGN_CANCELLED', 'cancelled'],
      ['SIGN_LINK_EXPIRED', 'expired'],
    ] as const) {
      expect(verifyOutcome(api(409, code, { state }))).toEqual({ kind: 'refused', state });
    }
    expect(verifyOutcome(api(404, 'KIOSK_CODE_NOT_FOUND'))).toEqual({ kind: 'gone' });
    expect(verifyOutcome(api(404, 'SIGN_LINK_NOT_FOUND'))).toEqual({ kind: 'gone' });
  });

  it('a staff user signed in on the office computer (409, no state): the API text', () => {
    expect(verifyOutcome(api(409, 'KIOSK_STAFF_SIGNED_IN'))).toEqual({
      kind: 'retry',
      message: errorMessage('KIOSK_STAFF_SIGNED_IN'),
    });
  });

  it('400 is a field error; 429 waits, in minutes rounded up', () => {
    expect(verifyOutcome(api(400, 'INVALID_ID_NUMBER'))).toEqual({
      kind: 'retry',
      message: text.invalid,
    });
    expect(verifyOutcome(api(400, 'VALIDATION_FAILED'))).toEqual({
      kind: 'retry',
      message: text.invalid,
    });
    expect(verifyOutcome(api(429, 'SIGN_TOO_MANY_REQUESTS', undefined, 61))).toEqual({
      kind: 'retry',
      message: text.wait(2),
      waitSeconds: 61,
    });
    expect(verifyOutcome(api(429, 'SIGN_TOO_MANY_REQUESTS'))).toEqual({
      kind: 'retry',
      message: errorMessage('SIGN_TOO_MANY_REQUESTS'),
    });
  });

  it('an ended session has its own line (never the staff login); no connection; a crash', () => {
    expect(verifyOutcome(api(401, 'SIGN_SESSION_EXPIRED'))).toEqual({
      kind: 'retry',
      message: errorMessage('SIGN_SESSION_EXPIRED'),
    });
    const network = new ApiRequestError({ kind: 'network' });
    expect(verifyOutcome(network)).toEqual({ kind: 'retry', message: network.message });
    expect(verifyOutcome(new Error('boom'))).toEqual({
      kind: 'retry',
      message: he.feedback.crashText,
    });
  });
});
