import type {
  AlreadySignedChoice,
  EmailStatus,
  RecipientsPreviewReport,
  RoundMode,
  RoundSent,
  RoundSettings,
  UserRole,
} from '@doc-signing/shared';

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
  'template.previewed',
  'template.preview_checked',
  'round.recipients_previewed',
  'round.created',
  'round.sent',
  'round.sending_finished',
  'assignment.invite_sent',
  'assignment.invite_failed',
  'settings.updated',
  'settings.employer_signature_uploaded',
  'settings.employer_signature_viewed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'user',
  'employee',
  'import_batch',
  'template',
  'round',
  'assignment',
  'settings',
] as const;
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
  'import.failed': {
    fileName: string;
    /** `format_changed`: failed by the 3.19 migration (the import reader changed). */
    reason: 'stale' | 'expired' | 'file_missing' | 'format_changed';
  };
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
  /**
   * The preview PDF was viewed (FR-TPL-3). `employeeId` null = the made-up sample employee. Ids
   * only: never the values drawn (NFR-PRV-7).
   */
  'template.previewed': { employeeId: string | null };
  /** What a real employee is missing on this template was checked (field names only shown). */
  'template.preview_checked': { employeeId: string };
  // Rounds (3.8): the manager is the actor.
  /**
   * The recipient preview was shown (FR-RND-4). No round exists yet (entity id NULL). Counts and
   * ids of the choice only: never names, employee ids or values (the answer showed names).
   */
  'round.recipients_previewed': {
    mode: RoundMode;
    all: boolean;
    departmentCount: number;
    employeeIdCount: number;
    templateIds: string[];
    alreadySigned: AlreadySignedChoice;
    counts: RecipientsPreviewReport['counts'];
  };
  /**
   * A draft round was created (3.9), entity = the round. The choice, its templates, settings and
   * counts only: never the round name (a correction round's name holds the employee's name),
   * names, employee ids or values.
   */
  'round.created': {
    mode: RoundMode;
    all: boolean;
    departmentCount: number;
    employeeIdCount: number;
    /** The template ids in round_templates (each once). */
    templateIds: string[];
    alreadySigned: AlreadySignedChoice;
    settings: RoundSettings;
    counts: RecipientsPreviewReport['counts'];
  };
  /**
   * A draft round was sent (3.10), entity = the round: the statuses changed, values saved and the
   * invitations queued. Ids and counts only: `valuesSaved` says how many documents got their
   * values, never the values (NFR-PRV-7).
   */
  'round.sent': {
    templateIds: string[];
    /** Outdated templates the manager confirmed sending as they are. */
    outdatedTemplateIds: string[];
    linkExpiresAt: string;
    counts: RoundSent['counts'];
    valuesSaved: number;
    textWarnings: number;
  };
  /** Every invitation of the round is settled (system actor): `sending` → `active`. */
  'round.sending_finished': { sent: number; failed: number };
  /**
   * One invitation went out (system actor, entity = the assignment). `unconfirmed`: it may have
   * gone out, but the provider never confirmed it (a crash or a timeout); it is not sent again.
   */
  'assignment.invite_sent': {
    roundId: string;
    emailMessageId: string;
    unconfirmed: boolean;
    providerCode: string | null;
  };
  /** One invitation failed for good (system actor). The provider's code only, never its text. */
  'assignment.invite_failed': {
    roundId: string;
    emailMessageId: string;
    reason:
      'permanent' | 'temporary_last_attempt' | 'unexpected_last_attempt' | 'assignment_closed';
    providerCode: string | null;
  };
  // Settings (3.18): the manager is the actor; the entity is `settings` with no id (text keys).
  /** One line per changed value, "field: old → new" (`null` = no limit). */
  'settings.updated': { changes: string[] };
  /** A new employer signature image (FR-ADM-2). `fileId` is the uuid in its storage key. */
  'settings.employer_signature_uploaded': {
    fileId: string;
    width: number;
    height: number;
    size: number;
    fileSha256: string;
    /** The image this one replaces (kept in storage), if any. */
    replacedFileId: string | null;
  };
  /** A short-lived link to the image was given out (NFR-SEC-8). */
  'settings.employer_signature_viewed': { fileId: string };
}
