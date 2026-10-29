import { errorMessage } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import { STAFF } from './users.fixtures';
import {
  checkNewUser,
  checkPassword,
  emptyNewUser,
  serverUserErrors,
  userActions,
} from './user-form';

const errors = he.users.errors;
const LENGTH = errors.passwordLength(10, 128);
const [me, otherManager, officer] = STAFF;
if (!me || !otherManager || !officer) throw new Error('fixtures');

describe('checkNewUser', () => {
  it('names every empty field', () => {
    expect(checkNewUser(emptyNewUser())).toEqual({
      input: null,
      errors: { fullName: errors.required, email: errors.required, password: LENGTH },
    });
  });

  it('lowercases the email, keeps the password as typed (not trimmed)', () => {
    const password = ' a long pass phrase ';
    expect(
      checkNewUser({
        fullName: ' דנה ',
        email: ' New.User@Example.TEST ',
        role: 'manager',
        password,
      }),
    ).toEqual({
      input: { fullName: 'דנה', email: 'new.user@example.test', role: 'manager', password },
      errors: {},
    });
  });

  it('a bad email, a long name, a short password', () => {
    expect(
      checkNewUser({ fullName: 'א'.repeat(101), email: 'nope', role: 'officer', password: 'short' })
        .errors,
    ).toEqual({ fullName: errors.tooLong(100), email: errors.emailInvalid, password: LENGTH });
  });
});

describe('checkPassword', () => {
  it('10 to 128 characters, nothing else', () => {
    expect(checkPassword('a'.repeat(9))).toBe(LENGTH);
    expect(checkPassword('a'.repeat(10))).toBeNull();
    expect(checkPassword('א'.repeat(128))).toBeNull();
    expect(checkPassword('a'.repeat(129))).toBe(LENGTH);
  });
});

describe('serverUserErrors', () => {
  it('EMAIL_TAKEN goes under the email; a password 400 under the password', () => {
    expect(
      serverUserErrors(new ApiRequestError({ kind: 'api', status: 409, code: 'EMAIL_TAKEN' })),
    ).toEqual({ email: errorMessage('EMAIL_TAKEN') });
    expect(
      serverUserErrors(
        new ApiRequestError({
          kind: 'api',
          status: 400,
          code: 'VALIDATION_FAILED',
          details: { fields: [{ field: 'password', code: 'INVALID_VALUE', message: 'x' }] },
        }),
      ),
    ).toEqual({ password: LENGTH });
  });

  it('the 409s about access belong to no field', () => {
    for (const code of ['CANNOT_CHANGE_OWN_ACCESS', 'LAST_ACTIVE_MANAGER'] as const) {
      expect(serverUserErrors(new ApiRequestError({ kind: 'api', status: 409, code }))).toBeNull();
    }
  });
});

describe('userActions', () => {
  it('own row: no disable, no "make officer"; a password reset is allowed', () => {
    expect(userActions(me, me.id)).toEqual({
      makeManager: false,
      makeOfficer: false,
      disable: false,
      enable: false,
      resetPassword: true,
    });
  });

  it('another manager can be demoted and disabled; a disabled officer promoted and enabled', () => {
    expect(userActions(otherManager, me.id)).toMatchObject({ makeOfficer: true, disable: true });
    expect(userActions(officer, me.id)).toMatchObject({
      makeManager: true,
      makeOfficer: false,
      disable: false,
      enable: true,
    });
  });
});
