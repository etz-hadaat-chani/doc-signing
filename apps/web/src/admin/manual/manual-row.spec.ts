import { errorMessage } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import { fixEmailInput, manualActions, sendFailure } from './manual-row';
import { corrected, emailAdded, lockedOut, missingData, noEmail } from './manual.fixtures';

describe('manualActions', () => {
  it.each([
    ['no email', noEmail, ['fixEmail', 'print', 'scan', 'kiosk']],
    ['email added', emailAdded, ['send', 'fixEmail', 'print', 'scan', 'kiosk']],
    ['missing data', missingData, ['editCard']],
    [
      'details completed',
      { ...missingData, ready: 'details_completed' as const },
      ['send', 'editCard'],
    ],
    ['email corrected (signed)', corrected, ['useGiven']],
    ['locked, no unlocks left', lockedOut, ['print', 'scan', 'kiosk']],
  ])('%s → %j', (_, row, expected) => {
    expect(manualActions(row)).toEqual(expected);
  });
});

describe('sendFailure (only a 4xx in our format proves nothing was sent)', () => {
  it('409 with details.refused: every row with its Hebrew text and the missing names', () => {
    const error = new ApiRequestError({
      kind: 'api',
      status: 409,
      code: 'MISSING_DATA_STILL_MISSING',
      details: {
        refused: [
          { assignmentId: 'a', code: 'MISSING_DATA_STILL_MISSING', missing: ['כתובת'] },
          { assignmentId: 'b', code: 'EMAIL_ALREADY_QUEUED' },
          { assignmentId: 'c', code: 'NOT_A_REAL_CODE' },
        ],
      },
    });
    expect(sendFailure(error)).toEqual({
      kind: 'refused',
      rows: [
        {
          assignmentId: 'a',
          message: errorMessage('MISSING_DATA_STILL_MISSING'),
          missing: ['כתובת'],
        },
        { assignmentId: 'b', message: errorMessage('EMAIL_ALREADY_QUEUED'), missing: [] },
        { assignmentId: 'c', message: he.feedback.unexpectedText, missing: [] },
      ],
    });
  });

  it('another 4xx: not sent, its Hebrew text', () => {
    const error = new ApiRequestError({ kind: 'api', status: 404, code: 'ASSIGNMENT_NOT_FOUND' });
    expect(sendFailure(error)).toEqual({ kind: 'notSent', message: error.message });
  });

  it('a 5xx, no answer or an answer that is not ours: maybe sent', () => {
    expect(
      sendFailure(new ApiRequestError({ kind: 'api', status: 500, code: 'INTERNAL_ERROR' })),
    ).toEqual({
      kind: 'maybe',
    });
    expect(sendFailure(new ApiRequestError({ kind: 'network' }))).toEqual({ kind: 'maybe' });
    expect(sendFailure(new ApiRequestError({ kind: 'unexpected', status: 418 }))).toEqual({
      kind: 'maybe',
    });
    expect(sendFailure(new Error('boom'))).toEqual({ kind: 'maybe' });
  });
});

describe('fixEmailInput', () => {
  it('trims and lowercases a real address', () => {
    expect(fixEmailInput('  New@Example.TEST ')).toEqual({ email: 'new@example.test' });
  });

  it('refuses an empty or malformed one (the API would store it as "invalid")', () => {
    expect(fixEmailInput('   ')).toEqual({ error: he.manual.fixEmail.required });
    expect(fixEmailInput('not an email')).toEqual({ error: he.manual.fixEmail.invalid });
  });
});
