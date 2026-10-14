import type { UpdateUserInput, UserRole } from '@doc-signing/shared';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';

/** The fields of the user being changed that the rules look at. */
export interface CurrentUserState {
  id: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

/** One real change, in the order it is logged. */
export type UserChange =
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'role_changed'; from: UserRole; to: UserRole }
  | { kind: 'disabled' }
  | { kind: 'enabled' }
  | { kind: 'password_reset' };

export interface UserChangeContext {
  /** The manager making the change. */
  actorId: string;
  /** Ids of all active managers, read under lock in this transaction. */
  activeManagerIds: readonly string[];
}

/**
 * Compares the request with the user as stored and returns only the real changes (same value =
 * no change, no log row). A password in the request is always a reset. Throws 409 when the
 * change would take away the actor's own access, or leave no active manager.
 */
export function planUserChanges(
  current: CurrentUserState,
  input: UpdateUserInput,
  { actorId, activeManagerIds }: UserChangeContext,
): UserChange[] {
  const changes: UserChange[] = [];
  if (input.fullName !== undefined && input.fullName !== current.fullName) {
    changes.push({ kind: 'renamed', from: current.fullName, to: input.fullName });
  }
  if (input.role !== undefined && input.role !== current.role) {
    changes.push({ kind: 'role_changed', from: current.role, to: input.role });
  }
  if (input.isActive !== undefined && input.isActive !== current.isActive) {
    changes.push({ kind: input.isActive ? 'enabled' : 'disabled' });
  }
  if (input.password !== undefined) changes.push({ kind: 'password_reset' });

  const wasActiveManager = current.role === 'manager' && current.isActive;
  const staysActiveManager =
    (input.role ?? current.role) === 'manager' && (input.isActive ?? current.isActive);
  if (wasActiveManager && !staysActiveManager) {
    if (current.id === actorId) {
      throw new AppException('CANNOT_CHANGE_OWN_ACCESS', HttpStatus.CONFLICT);
    }
    if (!activeManagerIds.some((id) => id !== current.id)) {
      throw new AppException('LAST_ACTIVE_MANAGER', HttpStatus.CONFLICT);
    }
  }
  return changes;
}
