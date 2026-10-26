import type {
  AlreadySignedChoice,
  AssignmentStatus,
  DailyRemindSkipReason,
  EmailChoice,
  EmailMessageType,
  EmailStatus,
  RecipientsPreviewReport,
  RemindSkipReason,
  RoundMode,
  RoundSent,
  RoundSettings,
  RoundStatus,
  SignLinkState,
  SignRateScope,
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
  'round.assignments_viewed',
  'round.remind_queued',
  'round.cancelled',
  'reminders.daily_run',
  'assignment.invite_sent',
  'assignment.invite_failed',
  'assignment.reminder_sent',
  'assignment.reminder_failed',
  'assignment.remind_queued',
  'assignment.resend_queued',
  'assignment.unlocked',
  'assignment.cancelled',
  'assignment.signed',
  'assignment.signed_copy_sent',
  'assignment.signed_copy_failed',
  'assignment.manual_send',
  'assignment.kiosk_opened',
  'assignment.printed',
  'assignment.signed_manual',
  'assignment.responses_viewed',
  'assignment.approved',
  'assignment.returned',
  'assignment.sent_again',
  'email.bounced',
  'email.soft_bounced',
  'sign.verified',
  'sign.verify_failed',
  'sign.locked',
  'sign.verify_refused',
  'sign.document_viewed',
  'sign.form_viewed',
  'sign.rate_limited',
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
  'job',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * Why an invitation or reminder failed for good. `job_lost`: its job died without settling it
 * (3.14 sweep).
 */
export type SigningEmailFailReason =
  | 'permanent'
  | 'temporary_last_attempt'
  | 'unexpected_last_attempt'
  | 'assignment_closed'
  | 'job_lost';

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
   * A page of the employee table (3.11) showed email addresses the employees gave (NFR-PRV-7:
   * answers are viewed with a log). Counts only: never the search text, names or addresses.
   */
  'round.assignments_viewed': {
    page: number;
    pageSize: number;
    rowCount: number;
    emailAnswersShown: number;
    searched: boolean;
  };
  /**
   * The manager reminded the whole round now (3.12, FR-REM-3): how many reminders were queued
   * and why the others were skipped. Counts only.
   */
  'round.remind_queued': {
    queued: number;
    skipped: Record<RemindSkipReason, number>;
  };
  /**
   * The manager cancelled the round (3.12, FR-RND-7): its open assignments, counted by the
   * status they had; signed ones stay. Counts only.
   */
  'round.cancelled': {
    fromStatus: RoundStatus;
    cancelled: number;
    byStatus: Partial<Record<AssignmentStatus, number>>;
    signedUntouched: number;
  };
  /**
   * One run of the daily reminder job (3.14; system actor, entity `job`, id NULL). Counts and
   * round ids only, never a name, an address or a link. `skipped`: `skip_date` = today is a
   * no-reminder date, nothing was queued. `swept`: queued emails whose job died, settled first.
   */
  'reminders.daily_run': {
    trigger: 'schedule' | 'manual';
    day: string;
    skipped: 'skip_date' | null;
    rounds: number;
    queued: number;
    notReminded: Record<DailyRemindSkipReason, number>;
    byRound: { roundId: string; queued: number }[];
    swept: { failed: number; unconfirmed: number; roundsFinished: number };
  };
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
    reason: SigningEmailFailReason;
    providerCode: string | null;
  };
  /** One reminder went out (system actor); the same details as the invitation's. */
  'assignment.reminder_sent': {
    roundId: string;
    emailMessageId: string;
    unconfirmed: boolean;
    providerCode: string | null;
  };
  /** One reminder failed for good, or could no longer go (`assignment_closed`). */
  'assignment.reminder_failed': {
    roundId: string;
    emailMessageId: string;
    reason: SigningEmailFailReason;
    providerCode: string | null;
  };
  // Round actions (3.12): the manager is the actor, the entity is the assignment. Ids only:
  // never the address, the name or the link.
  /** A reminder to one employee was queued (the worker sends it). */
  'assignment.remind_queued': { roundId: string; emailMessageId: string };
  /** A new invitation was queued after a failed send or a fixed wrong email. */
  'assignment.resend_queued': {
    roundId: string;
    emailMessageId: string;
    fromStatus: AssignmentStatus;
  };
  /**
   * The lock after wrong ID attempts was lifted (`failed_attempts` back to 0). The number of
   * attempts and earlier unlocks only; the numbers typed are never stored.
   */
  'assignment.unlocked': {
    roundId: string;
    lockedAt: string;
    failedAttempts: number;
    previousUnlocks: number;
  };
  /** One employee's assignment was cancelled; every link of it now shows "cancelled". */
  'assignment.cancelled': { roundId: string; fromStatus: AssignmentStatus };
  // Employee signing (3.13): the employee is the actor (her IP in `ip`), the assignment the
  // entity, `emailMessageId` the link used (null at the office kiosk, 3.16: `kioskSessionId`). Never the typed ID number, the link token, an
  // address, an answer or a saved value (NFR-PRV-7).
  /** A correct ID number: a 15-minute signing session started. */
  'sign.verified': {
    roundId: string;
    emailMessageId: string | null;
    kioskSessionId?: string;
    fromStatus: AssignmentStatus;
  };
  /** A wrong ID number; `failedAttempts` counts it. */
  'sign.verify_failed': {
    roundId: string;
    emailMessageId: string | null;
    kioskSessionId?: string;
    failedAttempts: number;
  };
  /** The 5th wrong ID number locked the assignment (FR-SGN-2). */
  'sign.locked': {
    roundId: string;
    emailMessageId: string | null;
    kioskSessionId?: string;
    failedAttempts: number;
  };
  /** An ID number sent to a link that is signed, cancelled, expired or locked; not compared. */
  'sign.verify_refused': {
    roundId: string;
    emailMessageId: string | null;
    kioskSessionId?: string;
    state: SignLinkState;
  };
  /** The personalized document was viewed (B2). */
  'sign.document_viewed': {
    roundId: string;
    emailMessageId: string | null;
    kioskSessionId?: string;
  };
  /** The form was read (B3); `correction`: a correction round, so the note was shown. */
  'sign.form_viewed': {
    roundId: string;
    emailMessageId: string | null;
    kioskSessionId?: string;
    correction: boolean;
  };
  /**
   * One IP first went over a per-IP limit in a 15-minute window (entity id NULL; the IP is in
   * `ip`). Logged once per IP, scope and window, to tune the limits.
   */
  'sign.rate_limited': { scope: SignRateScope; limit: number };
  /**
   * Signed (NFR-SIG-2, NFR-SIG-4): the stored file's SHA-256 and size, the email choice and the
   * keys answered, never the values or the address. `fileReused`: a retry found the file
   * already stored. `strayFileKeys`: files of earlier attempts that are not the final ones.
   */
  'assignment.signed': {
    roundId: string;
    emailMessageId: string | null;
    signMethod: 'digital' | 'kiosk';
    fileSha256: string;
    fileSize: number;
    fileReused: boolean;
    reference: string;
    emailChoice: EmailChoice | null;
    answeredKeys: string[];
    drawingKeys: string[];
    needsApproval: boolean;
    strayFileKeys: string[];
    userAgent: string | null;
    /** Kiosk only (3.16): the kiosk session, the manager who opened it, the copy's email row. */
    kioskSessionId?: string;
    handledById?: string;
    signedCopyEmailId?: string | null;
  };
  /** The signed copy went out (system actor); the same details as an invitation's. */
  'assignment.signed_copy_sent': {
    roundId: string;
    emailMessageId: string;
    unconfirmed: boolean;
    providerCode: string | null;
  };
  /** The signed copy failed for good (system actor). The assignment stays signed. */
  'assignment.signed_copy_failed': {
    roundId: string;
    emailMessageId: string;
    reason: 'permanent' | 'temporary_last_attempt' | 'unexpected_last_attempt';
    providerCode: string | null;
  };
  // Manual handling (3.16): the manager is the actor, the assignment the entity. Ids, statuses
  // and file facts only: never an address, a name, a saved value or the uploaded file's name.
  /**
   * Sent from manual handling: `pending` with a queued invitation, or `no_email` (details
   * completed, still no valid email). `valuesSaved`: the values were saved now (`missing_data`).
   */
  'assignment.manual_send': {
    roundId: string;
    fromStatus: AssignmentStatus;
    toStatus: 'pending' | 'no_email';
    emailMessageId: string | null;
    valuesSaved: boolean;
  };
  /** The personalized PDF was printed (a document view: it holds the ID number). */
  'assignment.printed': { roundId: string; templateId: string };
  /**
   * The office signing station was opened (FR-MAN-4); `replaced`: earlier kiosk sessions of
   * the assignment it ended. Never the code.
   */
  'assignment.kiosk_opened': {
    roundId: string;
    kioskSessionId: string;
    expiresAt: string;
    replaced: number;
  };
  /**
   * A scanned paper document was stored: `signed_manual` (FR-MAN-3). No answers, no signed copy.
   * `fileReused`: the same bytes were already at the key (a retried upload); `strayFileKeys`:
   * other files found at the key, left as they are.
   */
  'assignment.signed_manual': {
    roundId: string;
    fromStatus: AssignmentStatus;
    signMethod: 'manual';
    fileSha256: string;
    fileSize: number;
    pageCount: number;
    fileReused: boolean;
    strayFileKeys: string[];
  };
  // Approvals (3.16 part B2): manager or officer actor, entity = the assignment. Ids and counts
  // only: never an answer, an address, a name or the return note.
  /** The employee's answers were viewed (a document view: answers and the address she gave). */
  'assignment.responses_viewed': {
    roundId: string;
    answerCount: number;
    drawingCount: number;
    emailShown: boolean;
  };
  /** A signed document waiting for approval was approved (FR-TRK-6); the file is untouched. */
  'assignment.approved': { roundId: string };
  /** Returned for correction: `signed` → `cancelled`. The note is never logged. */
  'assignment.returned': { roundId: string; fromStatus: 'signed' };
  /**
   * The correction round of a returned assignment was created and sent (with its own
   * `round.created` and `round.sent` rows); `status`: her row in the new round.
   */
  'assignment.sent_again': {
    roundId: string;
    correctionRoundId: string;
    templateId: string;
    status: AssignmentStatus;
  };
  // Bounce notices (3.15): system actor, entity = the assignment of the email that bounced. Ids
  // and counts only: never the address, a name or the provider's text.
  /**
   * A hard bounce. `employeeMarkedBounced`: her stored email was that address, now `bounced`.
   * `invalidatedAssignmentIds`: her open assignments whose newest link went to that address,
   * now `invalid_email` (a signed one never changes).
   */
  'email.bounced': {
    roundId: string;
    emailMessageId: string;
    emailType: EmailMessageType;
    employeeMarkedBounced: boolean;
    invalidatedAssignmentIds: string[];
  };
  /** A soft bounce (mailbox full, server busy): logged only, nothing changes. */
  'email.soft_bounced': { roundId: string; emailMessageId: string; emailType: EmailMessageType };
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
