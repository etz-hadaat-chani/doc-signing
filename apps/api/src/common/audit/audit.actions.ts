import type { UserRole } from '@doc-signing/shared';

/**
 * The only action names and entity types the activity log accepts (`audit_log.action` and
 * `entity_type`, varchar(50)). A fixed list, so a typo can't create a new name. Each later task
 * adds its own actions here and to AuditDetailsMap: document views (3.17), sends, reminders,
 * signing (with the file's SHA-256, NFR-SIG-2), ID attempts, unlocks, imports, manual handling.
 */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.login_blocked',
  'auth.logout',
  'user.created',
  'user.renamed',
  'user.role_changed',
  'user.disabled',
  'user.enabled',
  'user.password_reset',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = ['user'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * The details each action may carry. Never passwords, link tokens or ID numbers; AuditService
 * also enforces this at run time (audit-details.ts).
 */
export interface AuditDetailsMap {
  'auth.login': { userAgent: string | null };
  /** The email as typed (lowercased); the target account, if any, is the entity. */
  'auth.login_failed': {
    email: string;
    reason: 'unknown_email' | 'wrong_password' | 'user_disabled';
  };
  /** Logged once, on the attempt that first goes over the email or IP limit. */
  'auth.login_blocked': { email: string; limitedBy: 'email' | 'ip' };
  'auth.logout': Record<string, never>;
  // Staff users (3.1): the acting manager is the actor, the changed user the entity.
  'user.created': { email: string; fullName: string; role: UserRole };
  'user.renamed': { from: string; to: string };
  'user.role_changed': { from: UserRole; to: UserRole };
  /** Disabling ends all of the user's sessions at once. */
  'user.disabled': { sessionsEnded: number };
  'user.enabled': Record<string, never>;
  /** Never the password itself. Ends the user's sessions (all but the current one for self). */
  'user.password_reset': { sessionsEnded: number };
}
