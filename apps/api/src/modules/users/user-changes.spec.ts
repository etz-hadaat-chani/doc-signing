import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/errors/app.exception.js';
import { type CurrentUserState, planUserChanges } from './user-changes.js';

const actorId = 'actor';
const otherManager: CurrentUserState = {
  id: 'other',
  fullName: 'מנהל שני',
  role: 'manager',
  isActive: true,
};
const officer: CurrentUserState = { id: 'off', fullName: 'ממונה', role: 'officer', isActive: true };
const twoManagers = { actorId, activeManagerIds: [actorId, 'other'] };

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof AppException) return error.code;
    throw error;
  }
  return undefined;
}

describe('planUserChanges', () => {
  it('lists each real change in log order', () => {
    expect(
      planUserChanges(
        officer,
        { fullName: 'שם חדש', role: 'manager', isActive: false, password: 'a'.repeat(10) },
        twoManagers,
      ),
    ).toEqual([
      { kind: 'renamed', from: 'ממונה', to: 'שם חדש' },
      { kind: 'role_changed', from: 'officer', to: 'manager' },
      { kind: 'disabled' },
      { kind: 'password_reset' },
    ]);
  });

  it('skips values that are already set', () => {
    expect(
      planUserChanges(officer, { fullName: 'ממונה', role: 'officer', isActive: true }, twoManagers),
    ).toEqual([]);
  });

  it('enables a disabled user', () => {
    expect(
      planUserChanges({ ...officer, isActive: false }, { isActive: true }, twoManagers),
    ).toEqual([{ kind: 'enabled' }]);
  });

  it('lets a manager rename themselves and reset their own password', () => {
    const self = { ...otherManager, id: actorId };
    expect(
      planUserChanges(self, { fullName: 'אני', password: 'a'.repeat(10) }, twoManagers),
    ).toHaveLength(2);
  });

  it.each([
    ['disable themselves', { isActive: false }],
    ['make themselves an officer', { role: 'officer' as const }],
  ])('refuses a manager who tries to %s', (_name, input) => {
    const self = { ...otherManager, id: actorId };
    expect(errorCode(() => planUserChanges(self, input, twoManagers))).toBe(
      'CANNOT_CHANGE_OWN_ACCESS',
    );
  });

  it('lets a manager disable or demote another manager while one stays', () => {
    expect(planUserChanges(otherManager, { isActive: false }, twoManagers)).toEqual([
      { kind: 'disabled' },
    ]);
    expect(planUserChanges(otherManager, { role: 'officer' }, twoManagers)).toHaveLength(1);
  });

  it.each([
    ['disabling', { isActive: false }],
    ['demoting', { role: 'officer' as const }],
  ])('refuses %s the last active manager', (_name, input) => {
    const context = { actorId, activeManagerIds: ['other'] };
    expect(errorCode(() => planUserChanges(otherManager, input, context))).toBe(
      'LAST_ACTIVE_MANAGER',
    );
  });

  it('allows changes to a disabled manager, who is not counted', () => {
    const disabled = { ...otherManager, isActive: false };
    const context = { actorId, activeManagerIds: [actorId] };
    expect(planUserChanges(disabled, { role: 'officer' }, context)).toHaveLength(1);
  });

  it('allows disabling an officer even with one manager', () => {
    const context = { actorId, activeManagerIds: [actorId] };
    expect(planUserChanges(officer, { isActive: false }, context)).toEqual([{ kind: 'disabled' }]);
  });
});
