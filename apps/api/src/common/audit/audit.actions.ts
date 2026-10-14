import type { EmailStatus, UserRole } from '@doc-signing/shared';

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
  'employee.created',
  'employee.updated',
  'import.preview',
  'import.commit',
  'import.failed',
  'template.created',
  'template.updated',
  'template.version_created',
  'template.archived',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = ['user', 'employee', 'import_batch', 'template'] as const;
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
  // Employees (3.2): the acting manager is the actor, the employee the entity. Never the ID number.
  /** `importBatchId` when the Excel import created the employee (3.4), not a manager's form. */
  'employee.created': {
    employeeNumber: string;
    fullName: string;
    departmentCode: number;
    emailStatus: EmailStatus;
    importBatchId?: string;
  };
  /**
   * One line per changed field, "field: old → new"; the ID number only as "idNumber: changed".
   * `importBatchId` when the Excel import made the change (3.4).
   */
  'employee.updated': { changes: string[]; importBatchId?: string };
  // Excel import (3.3): the manager is the actor, the batch the entity. Counts only, no ID numbers.
  /** What the import would do; nothing is saved to employees or departments yet. */
  'import.preview': {
    fileName: string;
    rowsTotal: number;
    rowsNew: number;
    rowsUpdated: number;
    rowsUnchanged: number;
    rowsFailed: number;
    departmentsNew: number;
    departmentsRenamed: number;
  };
  /** The import was applied (3.4): final counts and the departments created or renamed by code. */
  'import.commit': {
    fileName: string;
    rowsTotal: number;
    rowsNew: number;
    rowsUpdated: number;
    rowsUnchanged: number;
    rowsFailed: number;
    departmentsNew: number;
    departmentsRenamed: number;
    newDepartments: { code: number; name: string }[];
    renamedDepartments: { code: number; from: string; to: string }[];
  };
  /** A confirm refused for good (the batch is now `failed`); nothing was written. */
  'import.failed': { fileName: string; reason: 'stale' | 'expired' | 'file_missing' };
  // Templates (3.5): the manager is the actor, the template version the entity.
  /** A PDF uploaded as version 1. Department codes, not ids. */
  'template.created': {
    name: string;
    version: number;
    pageCount: number;
    departmentCodes: number[];
  };
  /**
   * Changed in place: any change while unlocked, or only the department links while locked.
   * One line per change, "field: old → new" (positions as a count).
   */
  'template.updated': { version: number; changes: string[] };
  /** A locked template edited: logged on the new version, with what changed from the old one. */
  'template.version_created': {
    version: number;
    fromTemplateId: string;
    fromVersion: number;
    changes: string[];
  };
  'template.archived': { name: string; version: number };
}
