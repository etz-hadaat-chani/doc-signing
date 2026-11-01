import { type ErrorCode, errorMessage } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/api-error';
import { he } from '../i18n/he';
import { submitOutcome } from './submit-outcome';

const api = (
  status: number,
  code: ErrorCode,
  details?: Record<string, unknown>,
  retryAfterSeconds?: number,
) => new ApiRequestError({ kind: 'api', status, code, details, retryAfterSeconds });

const fieldsOf = (error: unknown) => {
  const outcome = submitOutcome(error);
  return outcome.kind === 'fields' ? Object.fromEntries(outcome.errors) : outcome;
};

describe('submitOutcome', () => {
  it('400 VALIDATION_FAILED: each field at its item', () => {
    const fields = [
      { field: 'answers.note', code: 'ANSWER_TOO_LONG', message: 'x' },
      { field: 'drawings.initials', code: 'DRAWING_EMPTY', message: 'x' },
      { field: 'emailChoice', code: 'EMAIL_CHOICE_REQUIRED', message: 'x' },
      { field: 'email', code: 'INVALID_EMAIL', message: 'x' },
      { field: 'acknowledged', code: 'SIGN_ACK_REQUIRED', message: 'x' },
    ];
    expect(fieldsOf(api(400, 'VALIDATION_FAILED', { fields }))).toEqual({
      note: errorMessage('ANSWER_TOO_LONG'),
      initials: errorMessage('DRAWING_EMPTY'),
      email_choice: errorMessage('EMAIL_CHOICE_REQUIRED'),
      email: errorMessage('INVALID_EMAIL'),
      acknowledged: errorMessage('SIGN_ACK_REQUIRED'),
    });
  });

  it('ANSWER_DOES_NOT_FIT and DRAWING_* name their box; SIGNATURE_* the signature pad', () => {
    expect(fieldsOf(api(400, 'ANSWER_DOES_NOT_FIT', { key: 'note' }))).toEqual({
      note: errorMessage('ANSWER_DOES_NOT_FIT'),
    });
    expect(fieldsOf(api(400, 'ANSWER_DOES_NOT_FIT', { key: 'email_input' }))).toEqual({
      email: errorMessage('ANSWER_DOES_NOT_FIT'),
    });
    expect(fieldsOf(api(400, 'DRAWING_IMAGE_TOO_LARGE', { key: 'initials' }))).toEqual({
      initials: errorMessage('DRAWING_IMAGE_TOO_LARGE'),
    });
    expect(fieldsOf(api(400, 'SIGNATURE_EMPTY'))).toEqual({
      signatureImage: errorMessage('SIGNATURE_EMPTY'),
    });
  });

  it('401 → session ended; 409 signed → already signed; other 409, 423, 404 → B5', () => {
    expect(submitOutcome(api(401, 'SIGN_SESSION_EXPIRED'))).toEqual({ kind: 'sessionEnded' });
    expect(submitOutcome(api(409, 'SIGN_ALREADY_SIGNED', { state: 'signed' }))).toEqual({
      kind: 'alreadySigned',
    });
    expect(submitOutcome(api(409, 'SIGN_CANCELLED', { state: 'cancelled' }))).toEqual({
      kind: 'refused',
      state: 'cancelled',
    });
    expect(submitOutcome(api(423, 'SIGN_LOCKED', { state: 'locked' }))).toEqual({
      kind: 'refused',
      state: 'locked',
    });
    expect(submitOutcome(api(404, 'KIOSK_CODE_NOT_FOUND'))).toEqual({ kind: 'gone' });
  });

  it('429 → wait; no connection, a staff user signed in or 413 → "try again" with a text', () => {
    expect(submitOutcome(api(429, 'SIGN_TOO_MANY_REQUESTS', undefined, 90))).toMatchObject({
      kind: 'wait',
      seconds: 90,
    });
    expect(submitOutcome(new ApiRequestError({ kind: 'network' }))).toEqual({
      kind: 'failed',
      message: he.feedback.networkText,
    });
    expect(submitOutcome(api(409, 'KIOSK_STAFF_SIGNED_IN'))).toEqual({
      kind: 'failed',
      message: errorMessage('KIOSK_STAFF_SIGNED_IN'),
    });
    expect(submitOutcome(api(413, 'PAYLOAD_TOO_LARGE'))).toEqual({
      kind: 'failed',
      message: errorMessage('PAYLOAD_TOO_LARGE'),
    });
  });
});
